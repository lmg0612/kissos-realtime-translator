import {
  API_BASE_URL,
  AUTH_ACCESS_TOKEN_STORAGE_KEY,
  AUTH_STORAGE_KEY,
  type OAuthProviderId,
} from "./constants";

export interface AuthSession {
  provider: OAuthProviderId;
  accessToken: string;
  user: {
    id: string;
    email?: string;
    name?: string;
  };
  expiresAt: number;
}

const OAUTH_REDIRECT_PATH = "oauth2";
const SERVER_OFF_MESSAGE = "Server is not running. Start the server and try again.";

interface OAuthProviderRuntimeConfig {
  label: string;
  clientId: string;
  authorizationEndpoint: string;
  scope: string;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomString(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Base64Url(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToBase64Url(new Uint8Array(digest));
}

function launchWebAuthFlow(url: string) {
  return new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!redirectUrl) {
        reject(new Error("OAuth redirect URL was empty."));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

async function getProviderConfig(providerId: OAuthProviderId) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/providers?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error(SERVER_OFF_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(`Failed to load OAuth provider config: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!contentType.includes("application/json")) {
    throw new Error(`Auth provider config returned non-JSON (${contentType}): ${text.slice(0, 120)}`);
  }

  const providers = JSON.parse(text) as Record<OAuthProviderId, OAuthProviderRuntimeConfig>;
  return providers[providerId];
}

async function createDevSession(provider: OAuthProviderId) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/auth/dev-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
  } catch {
    throw new Error(SERVER_OFF_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(`Development sign-in failed with ${response.status}.`);
  }

  return response.json() as Promise<AuthSession>;
}

function buildAuthorizeUrl(
  providerId: OAuthProviderId,
  provider: OAuthProviderRuntimeConfig,
  redirectUri: string,
  codeChallenge: string,
  state: string,
  nonce: string,
) {
  const url = new URL(provider.authorizationEndpoint);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (provider.scope) {
    url.searchParams.set("scope", provider.scope);
  }
  if (providerId === "google") {
    url.searchParams.set("nonce", nonce);
  }

  return url.toString();
}

async function exchangeCode(provider: OAuthProviderId, code: string, codeVerifier: string, redirectUri: string) {
  const response = await fetch(`${API_BASE_URL}/api/auth/exchange`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `OAuth exchange failed with ${response.status}`);
  }

  return response.json() as Promise<AuthSession>;
}

export function formatAuthErrorMessage(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Failed to fetch")) return SERVER_OFF_MESSAGE;
  return message.replace(/^Error:\s*/, "");
}

export async function getAuthSession() {
  const result = await chrome.storage.local.get([AUTH_STORAGE_KEY]);
  const session = result[AUTH_STORAGE_KEY] as AuthSession | undefined;
  if (!session?.accessToken) return null;

  if (session.expiresAt <= Date.now() + 30_000) {
    await clearAuthSession();
    return null;
  }

  return session;
}

export async function clearAuthSession() {
  await chrome.storage.local.remove([AUTH_STORAGE_KEY, AUTH_ACCESS_TOKEN_STORAGE_KEY]);
}

export async function signIn(providerId: OAuthProviderId) {
  const provider = await getProviderConfig(providerId);
  if (!provider?.clientId) {
    const session = await createDevSession(providerId);
    await chrome.storage.local.set({
      [AUTH_STORAGE_KEY]: session,
      [AUTH_ACCESS_TOKEN_STORAGE_KEY]: session.accessToken,
    });
    return session;
  }

  const redirectUri = chrome.identity.getRedirectURL(OAUTH_REDIRECT_PATH);
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = randomString(24);
  const nonce = randomString(24);
  const authUrl = buildAuthorizeUrl(providerId, provider, redirectUri, codeChallenge, state, nonce);
  const redirectedTo = await launchWebAuthFlow(authUrl);
  const redirectedUrl = new URL(redirectedTo);

  const returnedState = redirectedUrl.searchParams.get("state");
  if (returnedState !== state) {
    throw new Error("OAuth state mismatch.");
  }

  const error = redirectedUrl.searchParams.get("error");
  if (error) {
    throw new Error(redirectedUrl.searchParams.get("error_description") || error);
  }

  const code = redirectedUrl.searchParams.get("code");
  if (!code) {
    throw new Error("OAuth authorization code was missing.");
  }

  const session = await exchangeCode(providerId, code, codeVerifier, redirectUri);
  await chrome.storage.local.set({
    [AUTH_STORAGE_KEY]: session,
    [AUTH_ACCESS_TOKEN_STORAGE_KEY]: session.accessToken,
  });
  return session;
}
