export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "handshaking"
  | "connected"
  | "waiting_for_session"
  | "connection_error"
  | "reconnecting"
  | "connection_failed"
  | "server_error"
  | "auth_error"
  | "closed";

export type ConnectionErrorKind =
  | "network"
  | "server"
  | "protocol"
  | "abnormal_close"
  | "handshake_timeout"
  | "auth"
  | "runtime"
  | "vad"
  | "closed";

export type VadState =
  | "idle"
  | "starting"
  | "running"
  | "failed";

export interface ConnectionState {
  runId: string | null;
  status: ConnectionStatus;
  vadState: VadState;
  pin: string | null;
  lastError: string | null;
  errorKind: ConnectionErrorKind | null;
  closeCode: number | null;
  retryAttempt: number;
  nextRetryAt: number | null;
  retryStartedAt: number | null;
  phaseStartedAt: number | null;
  updatedAt: number;
}

export const CONNECTION_STATE_KEY = "connectionState";

export const DEFAULT_CONNECTION_STATE: ConnectionState = {
  runId: null,
  status: "idle",
  vadState: "idle",
  pin: null,
  lastError: null,
  errorKind: null,
  closeCode: null,
  retryAttempt: 0,
  nextRetryAt: null,
  retryStartedAt: null,
  phaseStartedAt: null,
  updatedAt: 0,
};

export const TERMINAL_CONNECTION_STATUSES = [
  "connection_failed",
  "server_error",
  "auth_error",
] as const;

export function isConnectionStatus(status: unknown): status is ConnectionStatus {
  return (
    status === "idle" ||
    status === "connecting" ||
    status === "handshaking" ||
    status === "connected" ||
    status === "waiting_for_session" ||
    status === "connection_error" ||
    status === "reconnecting" ||
    status === "connection_failed" ||
    status === "server_error" ||
    status === "auth_error" ||
    status === "closed"
  );
}

export function isActiveConnectionStatus(status: unknown) {
  return (
    status === "connecting" ||
    status === "handshaking" ||
    status === "connected" ||
    status === "waiting_for_session" ||
    status === "connection_error" ||
    status === "reconnecting"
  );
}

export function isVadState(state: unknown): state is VadState {
  return (
    state === "idle" ||
    state === "starting" ||
    state === "running" ||
    state === "failed"
  );
}

export function isTerminalConnectionStatus(status: unknown) {
  return TERMINAL_CONNECTION_STATUSES.includes(
    status as typeof TERMINAL_CONNECTION_STATUSES[number],
  );
}

export function normalizeConnectionState(value: unknown): ConnectionState {
  const partial =
    typeof value === "object" && value !== null
      ? value as Partial<ConnectionState>
      : {};

  return {
    ...DEFAULT_CONNECTION_STATE,
    ...partial,
    status: isConnectionStatus(partial.status) ? partial.status : "idle",
    vadState: isVadState(partial.vadState) ? partial.vadState : "idle",
  };
}

function canUseLocalStorageApi() {
  return Boolean(globalThis.chrome?.storage?.local);
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (response?.success === false) {
        reject(new Error(response.error || "Runtime message failed."));
        return;
      }
      resolve(response as T);
    });
  });
}

export async function getConnectionState() {
  const result = canUseLocalStorageApi()
    ? await chrome.storage.local.get([CONNECTION_STATE_KEY])
    : await sendRuntimeMessage<Record<string, unknown>>({
        type: "STORAGE_GET",
        keys: [CONNECTION_STATE_KEY],
      });

  return normalizeConnectionState(result[CONNECTION_STATE_KEY]);
}

export async function setConnectionState(update: Partial<ConnectionState>) {
  const current = await getConnectionState();
  const next: ConnectionState = {
    ...current,
    ...update,
    updatedAt: Date.now(),
  };

  if (canUseLocalStorageApi()) {
    await chrome.storage.local.set({ [CONNECTION_STATE_KEY]: next });
  } else {
    await sendRuntimeMessage({
      type: "STORAGE_SET",
      values: { [CONNECTION_STATE_KEY]: next },
    });
  }

  return next;
}
