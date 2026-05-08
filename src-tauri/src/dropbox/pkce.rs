use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::distributions::Alphanumeric;
use rand::Rng;
use sha2::{Digest, Sha256};

/// RFC 7636 minimum length is 43, max is 128. We pick 64 ASCII chars.
const VERIFIER_LEN: usize = 64;

/// Holds a freshly-generated PKCE pair.
#[derive(Debug, Clone)]
pub struct PkcePair {
    pub verifier: String,
    pub challenge: String,
}

/// Generate a fresh PKCE verifier + S256 challenge.
pub fn generate() -> PkcePair {
    let verifier: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(VERIFIER_LEN)
        .map(char::from)
        .collect();
    let challenge = challenge_for(&verifier);
    PkcePair { verifier, challenge }
}

/// Compute the S256 challenge for a given verifier.
/// Exposed so tests can verify the digest format.
pub fn challenge_for(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let digest = hasher.finalize();
    URL_SAFE_NO_PAD.encode(digest)
}

/// Generate an opaque random `state` token for CSRF protection on the OAuth
/// redirect.
pub fn state_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifier_is_correct_length() {
        let pair = generate();
        assert_eq!(pair.verifier.len(), VERIFIER_LEN);
    }

    #[test]
    fn verifier_only_contains_unreserved_characters() {
        let pair = generate();
        for ch in pair.verifier.chars() {
            assert!(ch.is_ascii_alphanumeric(), "non-alphanumeric char {ch}");
        }
    }

    #[test]
    fn challenge_is_url_safe_base64_no_pad_of_sha256() {
        let pair = generate();
        // 32 bytes -> 43 char base64 URL-safe (no pad)
        assert_eq!(pair.challenge.len(), 43);
        assert!(!pair.challenge.contains('='), "challenge must not be padded");
        assert!(!pair.challenge.contains('+'), "challenge must use URL-safe alphabet");
        assert!(!pair.challenge.contains('/'), "challenge must use URL-safe alphabet");
    }

    #[test]
    fn challenge_for_is_deterministic_and_matches_known_vector() {
        // Test vector from RFC 7636 §A.1
        // verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        // challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        let v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(v),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn generate_produces_unique_verifiers() {
        // Probability of two 64-char alphanumeric collisions is ~62^-64; if
        // this ever fires, something is wrong with the RNG.
        let a = generate();
        let b = generate();
        assert_ne!(a.verifier, b.verifier);
        assert_ne!(a.challenge, b.challenge);
    }

    #[test]
    fn state_token_is_url_safe_alphanumeric() {
        let s = state_token();
        assert_eq!(s.len(), 32);
        for ch in s.chars() {
            assert!(ch.is_ascii_alphanumeric());
        }
    }
}
