use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use url::Url;

#[derive(Debug, thiserror::Error)]
pub enum LoopbackError {
    #[error("could not bind any port in {start}..{end}: {source}")]
    Bind {
        start: u16,
        end: u16,
        source: std::io::Error,
    },
    #[error("loopback I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("malformed callback request line")]
    MalformedRequest,
    #[error("missing query parameter `{0}`")]
    MissingParam(&'static str),
    #[error("oauth state mismatch")]
    StateMismatch,
    #[error("oauth provider returned error: {error} (description: {description:?})")]
    ProviderError {
        error: String,
        description: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedCode {
    pub code: String,
    pub state: String,
}

/// Bind a TCP listener to the first available port in the given range on
/// localhost. Returns the listener and the port it ended up on.
pub fn bind_loopback(
    start_port: u16,
    end_port: u16,
) -> Result<(TcpListener, u16), LoopbackError> {
    debug_assert!(start_port < end_port);
    let mut last_err: Option<std::io::Error> = None;
    for port in start_port..end_port {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => return Ok((listener, port)),
            Err(e) => last_err = Some(e),
        }
    }
    Err(LoopbackError::Bind {
        start: start_port,
        end: end_port,
        source: last_err.unwrap_or_else(|| std::io::Error::other("no ports tried")),
    })
}

/// Parse the request line from a single HTTP request and pull the OAuth
/// callback parameters out of its target. Pure for testability.
pub fn parse_callback(request_line: &str, expected_state: &str) -> Result<CapturedCode, LoopbackError> {
    // request line: "GET /callback?code=...&state=... HTTP/1.1"
    let mut parts = request_line.split_whitespace();
    let _method = parts.next().ok_or(LoopbackError::MalformedRequest)?;
    let target = parts.next().ok_or(LoopbackError::MalformedRequest)?;
    let version = parts.next().ok_or(LoopbackError::MalformedRequest)?;
    if !target.starts_with('/') || !version.starts_with("HTTP/") {
        return Err(LoopbackError::MalformedRequest);
    }

    // Reconstruct against an arbitrary base; we only care about the query.
    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| LoopbackError::MalformedRequest)?;
    let q: HashMap<_, _> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();

    if let Some(error) = q.get("error") {
        return Err(LoopbackError::ProviderError {
            error: error.clone(),
            description: q.get("error_description").cloned(),
        });
    }

    let code = q
        .get("code")
        .ok_or(LoopbackError::MissingParam("code"))?
        .clone();
    let state = q
        .get("state")
        .ok_or(LoopbackError::MissingParam("state"))?
        .clone();
    if state != expected_state {
        return Err(LoopbackError::StateMismatch);
    }
    Ok(CapturedCode { code, state })
}

/// Produce the HTML body shown in the user's browser after the callback.
pub fn success_response_body() -> String {
    String::from(
        "<!doctype html><meta charset=\"utf-8\"><title>Connected</title>\
        <style>body{font-family:system-ui;margin:3rem;color:#222}\
        h1{margin:0 0 .5rem 0;font-size:1.25rem}p{color:#555}</style>\
        <h1>Connected to Dropbox</h1>\
        <p>You can close this window and return to Dropbox Interface.</p>",
    )
}

pub fn error_response_body(message: &str) -> String {
    format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Connection failed</title>\
        <style>body{{font-family:system-ui;margin:3rem;color:#222}}\
        h1{{margin:0 0 .5rem 0;font-size:1.25rem;color:#b91c1c}}\
        p{{color:#555}}</style>\
        <h1>Connection failed</h1>\
        <p>{}</p>",
        html_escape(message)
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Accept a single connection on the listener, read its first request line,
/// validate state, write a friendly HTML body back, then return the captured
/// code (or an error). Times out if no client connects.
pub fn accept_one(
    listener: &TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<CapturedCode, LoopbackError> {
    listener.set_nonblocking(false)?;
    // Bound the wait so we don't hang forever if the user closes the browser.
    listener.set_ttl(64).ok();

    // Use accept with a deadline by setting a read timeout on the resulting
    // stream and a connection deadline via `incoming` polling.
    let deadline = std::time::Instant::now() + timeout;
    listener.set_nonblocking(true)?;
    let stream = loop {
        match listener.accept() {
            Ok((s, _)) => break s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err(LoopbackError::Io(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "no callback received before timeout",
                    )));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(LoopbackError::Io(e)),
        }
    };
    listener.set_nonblocking(false)?;
    handle_stream(stream, expected_state)
}

fn handle_stream(
    mut stream: TcpStream,
    expected_state: &str,
) -> Result<CapturedCode, LoopbackError> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;

    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    // Drain headers so the client sees a complete response.
    let mut header_line = String::new();
    loop {
        header_line.clear();
        let n = reader.read_line(&mut header_line)?;
        if n == 0 || header_line == "\r\n" || header_line == "\n" {
            break;
        }
    }

    match parse_callback(request_line.trim_end(), expected_state) {
        Ok(captured) => {
            let body = success_response_body();
            write_http_response(&mut stream, 200, "OK", &body)?;
            Ok(captured)
        }
        Err(e) => {
            let body = error_response_body(&e.to_string());
            write_http_response(&mut stream, 400, "Bad Request", &body)?;
            Err(e)
        }
    }
}

fn write_http_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    body: &str,
) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: text/html; charset=utf-8\r\n\
         Content-Length: {len}\r\n\
         Connection: close\r\n\
         \r\n\
         {body}",
        len = body.len()
    );
    stream.write_all(response.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_callback_extracts_code_and_state() {
        let captured =
            parse_callback("GET /callback?code=abc&state=xyz HTTP/1.1", "xyz").unwrap();
        assert_eq!(
            captured,
            CapturedCode {
                code: "abc".into(),
                state: "xyz".into()
            }
        );
    }

    #[test]
    fn parse_callback_decodes_percent_encoded_values() {
        let captured = parse_callback(
            "GET /callback?code=a%2Bb&state=hello%20world HTTP/1.1",
            "hello world",
        )
        .unwrap();
        assert_eq!(captured.code, "a+b");
        assert_eq!(captured.state, "hello world");
    }

    #[test]
    fn parse_callback_rejects_state_mismatch() {
        let err = parse_callback(
            "GET /callback?code=abc&state=wrong HTTP/1.1",
            "expected",
        )
        .unwrap_err();
        assert!(matches!(err, LoopbackError::StateMismatch));
    }

    #[test]
    fn parse_callback_rejects_missing_code() {
        let err = parse_callback("GET /callback?state=xyz HTTP/1.1", "xyz").unwrap_err();
        match err {
            LoopbackError::MissingParam(p) => assert_eq!(p, "code"),
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[test]
    fn parse_callback_surfaces_provider_error() {
        let err = parse_callback(
            "GET /callback?error=access_denied&error_description=user%20declined&state=x HTTP/1.1",
            "x",
        )
        .unwrap_err();
        match err {
            LoopbackError::ProviderError { error, description } => {
                assert_eq!(error, "access_denied");
                assert_eq!(description.as_deref(), Some("user declined"));
            }
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[test]
    fn parse_callback_rejects_malformed_request_line() {
        let err = parse_callback("not a request line", "x").unwrap_err();
        assert!(matches!(err, LoopbackError::MalformedRequest));
    }

    #[test]
    fn html_escape_replaces_dangerous_characters() {
        assert_eq!(
            html_escape("<a href=\"x\">&y</a>"),
            "&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;"
        );
    }

    #[test]
    fn bind_loopback_returns_a_port_in_the_requested_range() {
        // A wide-enough range; in CI sandboxes some ports may be busy, so we
        // give it real elbow room.
        let (listener, port) = bind_loopback(53682, 53782).unwrap();
        assert!((53682..53782).contains(&port));
        let local = listener.local_addr().unwrap();
        assert!(local.ip().is_loopback());
        assert_eq!(local.port(), port);
    }
}
