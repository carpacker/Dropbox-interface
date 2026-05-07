export type DropboxEntry = {
  id: string;
  name: string;
  path_display?: string;
  path_lower?: string;
  [".tag"]: "file" | "folder" | "deleted";
};

export type DropboxListResult = {
  entries: DropboxEntry[];
  has_more: boolean;
  cursor: string;
};

export type DropboxTemporaryLinkResult = {
  metadata: DropboxEntry;
  link: string;
};

export type DropboxCursorResult = {
  cursor: string;
};

export type DropboxTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  account_id?: string;
  uid?: string;
};

async function dropboxRequest<T>(token: string, endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dropbox API error (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

export function buildDropboxAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}) {
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function postTokenRequest(form: URLSearchParams) {
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Dropbox token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as DropboxTokenResponse;
}

export function exchangeDropboxCode(params: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const form = new URLSearchParams({
    code: params.code,
    grant_type: "authorization_code",
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });
  return postTokenRequest(form);
}

export function refreshDropboxToken(params: { clientId: string; refreshToken: string }) {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
  return postTokenRequest(form);
}

export function listDropboxFolder(token: string, path: string) {
  return dropboxRequest<DropboxListResult>(token, "files/list_folder", {
    path,
    recursive: false,
    include_deleted: false,
    include_mounted_folders: true,
    limit: 200,
  });
}

export function listDropboxFolderContinue(token: string, cursor: string) {
  return dropboxRequest<DropboxListResult>(token, "files/list_folder/continue", {
    cursor,
  });
}

export function getDropboxLatestCursor(token: string, path: string) {
  return dropboxRequest<DropboxCursorResult>(token, "files/list_folder/get_latest_cursor", {
    path,
    recursive: false,
    include_deleted: false,
    include_mounted_folders: true,
    limit: 200,
  });
}

export function getDropboxTemporaryLink(token: string, path: string) {
  return dropboxRequest<DropboxTemporaryLinkResult>(token, "files/get_temporary_link", {
    path,
  });
}
