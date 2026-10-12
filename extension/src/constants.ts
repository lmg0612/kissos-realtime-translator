export const API_BASE_URL = "http://<SERVER_HOST>";
export const WS_STREAM_URL = "ws://<SERVER_HOST>/api/streaming";

export const DEFAULT_DOMAIN = "general";
export const DEFAULT_LANGUAGES = ["Korean", "English"];
export const SELECTED_MIC_STORAGE_KEY = "sett_selected_microphone_id";
export const AUTH_STORAGE_KEY = "authSession";
export const AUTH_ACCESS_TOKEN_STORAGE_KEY = "authAccessToken";
export const FIRST_RUN_COMPLETED_STORAGE_KEY = "firstRunCompleted";

export const OAUTH_PROVIDERS = {
  google: {
    label: "Google",
    clientId: "YOUR_GOOGLE_CLIENT_ID",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    scope: "openid email profile",
  },
} as const;

export type OAuthProviderId = keyof typeof OAUTH_PROVIDERS;
