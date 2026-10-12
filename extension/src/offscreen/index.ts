import {
  type ConnectionErrorKind,
  setConnectionState,
} from "../connection-state";
import {
  AUTH_ACCESS_TOKEN_STORAGE_KEY,
  DEFAULT_DOMAIN,
  DEFAULT_LANGUAGES,
  WS_STREAM_URL,
} from "../constants";
import { setupVAD } from "../setup-vad";

const OPEN_TIMEOUT_MS = 8_000;
const ERROR_VISIBLE_MS = 400;
const RECONNECT_WINDOW_MS = 6_000;
const MAX_RETRY_DELAY_MS = 2_000;
const OFFLINE_RETRY_POLL_MS = 250;

type TerminalStatus = "connection_failed" | "server_error" | "auth_error";
type RetryableErrorKind = "network" | "protocol" | "abnormal_close" | "closed";

interface ServerMessage {
  type?: string;
  message?: string;
  pin?: string;
  sessionId?: string;
  payload?: {
    pin?: string;
    sessionId?: string;
    message?: string;
  };
}

let shouldReconnect = true;

function isBrowserOffline() {
  return navigator.onLine === false;
}

function createRunId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function getRetryDelay(attempt: number) {
  const baseDelay = Math.min(650 * 2 ** attempt, MAX_RETRY_DELAY_MS);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.floor(baseDelay * jitter);
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
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

async function getStoredAccessToken() {
  const response = await sendRuntimeMessage<Record<string, unknown>>({
    type: "STORAGE_GET",
    keys: [AUTH_ACCESS_TOKEN_STORAGE_KEY],
  });
  return response[AUTH_ACCESS_TOKEN_STORAGE_KEY] as string | undefined;
}

function buildAuthenticatedWebSocketUrl(accessToken: string) {
  const url = new URL(WS_STREAM_URL);
  url.searchParams.set("access_token", accessToken);
  return url.toString();
}

function closeOffscreenPreservingConnectionState() {
  return sendRuntimeMessage({
    type: "CLOSE_OFFSCREEN_PRESERVE_CONNECTION_STATE",
  });
}

function notifyInitialConnectionResult(success: boolean, error?: string) {
  return sendRuntimeMessage({
    type: "OFFSCREEN_INITIAL_CONNECTION_RESULT",
    success,
    error,
  }).catch(() => undefined);
}

function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;

  try {
    return JSON.parse(data) as ServerMessage;
  } catch {
    if (data.startsWith("Session ID:")) {
      const pin = data.replace("Session ID:", "").trim();
      return { type: "session", pin, sessionId: pin };
    }
    return null;
  }
}

function getPinFromMessage(message: ServerMessage) {
  return (
    message.payload?.pin ||
    message.payload?.sessionId ||
    message.pin ||
    message.sessionId ||
    null
  );
}

function isAuthErrorMessage(message: ServerMessage) {
  return message.type === "auth_error";
}

function isServerErrorMessage(message: ServerMessage) {
  return message.type === "server_error" || message.type === "error";
}

function classifyCloseEvent(event: CloseEvent): {
  retryable: boolean;
  errorKind: ConnectionErrorKind;
  terminalStatus: TerminalStatus;
  detail: string;
} {
  const detail = event.reason || `Connection closed with code ${event.code}.`;

  if (event.code === 1001) {
    return {
      retryable: false,
      errorKind: "server",
      terminalStatus: "server_error",
      detail,
    };
  }

  if (event.code === 1002) {
    return {
      retryable: true,
      errorKind: "protocol",
      terminalStatus: "connection_failed",
      detail,
    };
  }

  if (event.code === 1006) {
    return {
      retryable: true,
      errorKind: "abnormal_close",
      terminalStatus: "connection_failed",
      detail,
    };
  }

  return {
    retryable: event.code !== 1000,
    errorKind: "closed",
    terminalStatus: "connection_failed",
    detail,
  };
}

async function initVAD() {
  const urlParams = new URLSearchParams(window.location.search);
  const langsParam = urlParams.get("langs");
  const domainParam = urlParams.get("domain");
  const languages = langsParam ? langsParam.split(",").filter(Boolean) : DEFAULT_LANGUAGES;
  const domain = domainParam || DEFAULT_DOMAIN;
  const runId = createRunId();

  let socket: WebSocket | null = null;
  let retryAttempt = 0;
  let retryStartedAt: number | null = null;
  let reconnectTimer: number | null = null;
  let errorTimer: number | null = null;
  let openTimer: number | null = null;
  let networkPollTimer: number | null = null;
  let manualClose = false;
  let reconnectPending = false;
  let terminalStatusSet = false;
  let initialAccepted = false;
  let initialResultSent = false;
  let vadStarted = false;
  let accessToken = "";

  const clearTimer = (timer: number | null) => {
    if (timer) window.clearTimeout(timer);
  };

  const clearAllTimers = () => {
    clearTimer(reconnectTimer);
    clearTimer(errorTimer);
    clearTimer(openTimer);
    clearTimer(networkPollTimer);
    reconnectTimer = null;
    errorTimer = null;
    openTimer = null;
    networkPollTimer = null;
  };

  const updateConnection = (update: Parameters<typeof setConnectionState>[0]) => {
    return setConnectionState({ runId, ...update });
  };

  const notifyInitialSuccessOnce = () => {
    if (initialResultSent) return;
    initialResultSent = true;
    void notifyInitialConnectionResult(true);
  };

  const setTerminalState = (
    status: TerminalStatus,
    errorKind: ConnectionErrorKind,
    detail: string,
    closeCode: number | null,
  ) => {
    if (terminalStatusSet) return;

    terminalStatusSet = true;
    shouldReconnect = false;
    reconnectPending = false;
    clearAllTimers();
    void updateConnection({
      status,
      vadState: vadStarted ? "running" : "idle",
      pin: null,
      lastError: detail,
      errorKind,
      closeCode,
      retryAttempt,
      nextRetryAt: null,
      retryStartedAt,
      phaseStartedAt: Date.now(),
    });
    socket?.close();

    if (!initialResultSent) {
      initialResultSent = true;
      void notifyInitialConnectionResult(false, detail);
    }

    void closeOffscreenPreservingConnectionState();
  };

  const isInitialConnectionPhase = () => !initialAccepted;

  const queueReconnectAttempt = (
    errorKind: RetryableErrorKind,
    detail: string,
    closeCode: number | null,
    deadline: number,
  ) => {
    const retryAt = Date.now();
    const remainingMs = deadline - retryAt;
    if (remainingMs <= 0) {
      setTerminalState("connection_failed", errorKind, detail, closeCode);
      return;
    }

    if (isBrowserOffline()) {
      void updateConnection({
        status: "reconnecting",
        pin: null,
        lastError: detail,
        errorKind,
        closeCode,
        retryAttempt,
        nextRetryAt: Math.min(retryAt + OFFLINE_RETRY_POLL_MS, deadline),
        retryStartedAt,
        phaseStartedAt: retryAt,
      });

      networkPollTimer = window.setTimeout(() => {
        queueReconnectAttempt(errorKind, detail, closeCode, deadline);
      }, Math.min(OFFLINE_RETRY_POLL_MS, remainingMs));
      return;
    }

    const delay = Math.min(getRetryDelay(retryAttempt), remainingMs);
    const nextRetryAt = retryAt + delay;

    void updateConnection({
      status: "reconnecting",
      pin: null,
      lastError: detail,
      errorKind,
      closeCode,
      retryAttempt,
      nextRetryAt,
      retryStartedAt,
      phaseStartedAt: retryAt,
    });

    reconnectTimer = window.setTimeout(() => {
      reconnectPending = false;
      retryAttempt += 1;
      void connect();
    }, delay);
  };

  const scheduleReconnect = (
    errorKind: RetryableErrorKind,
    detail: string,
    closeCode: number | null,
  ) => {
    if (manualClose || !shouldReconnect || reconnectPending || terminalStatusSet) return;

    const now = Date.now();
    retryStartedAt ??= now;
    const deadline = retryStartedAt + RECONNECT_WINDOW_MS;

    if (now >= deadline) {
      setTerminalState("connection_failed", errorKind, detail, closeCode);
      return;
    }

    reconnectPending = true;
    clearAllTimers();
    void updateConnection({
      status: "connection_error",
      pin: null,
      lastError: detail,
      errorKind,
      closeCode,
      retryAttempt,
      nextRetryAt: null,
      retryStartedAt,
      phaseStartedAt: now,
    });

    errorTimer = window.setTimeout(() => {
      queueReconnectAttempt(errorKind, detail, closeCode, deadline);
    }, Math.min(ERROR_VISIBLE_MS, Math.max(0, deadline - now)));
  };

  const markAccepted = () => {
    initialAccepted = true;
    retryAttempt = 0;
    retryStartedAt = null;
    clearTimer(openTimer);
    openTimer = null;
    notifyInitialSuccessOnce();
  };

  const connect = async () => {
    reconnectPending = false;
    const phaseStartedAt = Date.now();

    if (isBrowserOffline()) {
      if (isInitialConnectionPhase()) {
        await updateConnection({
          status: "connecting",
          vadState: "idle",
          pin: null,
          lastError: null,
          errorKind: null,
          closeCode: null,
          retryAttempt,
          nextRetryAt: null,
          retryStartedAt: null,
          phaseStartedAt,
        });
        setTerminalState(
          "connection_failed",
          "network",
          "Browser is offline before the initial WebSocket connection.",
          null,
        );
        return;
      }

      scheduleReconnect("network", "Browser is offline during WebSocket reconnect.", null);
      return;
    }

    const retryDeadline = retryStartedAt ? retryStartedAt + RECONNECT_WINDOW_MS : null;
    const openTimeoutMs = retryDeadline
      ? Math.min(OPEN_TIMEOUT_MS, Math.max(0, retryDeadline - phaseStartedAt))
      : OPEN_TIMEOUT_MS;

    if (retryDeadline && openTimeoutMs <= 0) {
      setTerminalState("connection_failed", "handshake_timeout", "Timed out reconnecting.", null);
      return;
    }

    await updateConnection({
      status: retryAttempt > 0 ? "reconnecting" : "connecting",
      vadState: vadStarted ? "running" : "idle",
      pin: null,
      lastError: null,
      errorKind: null,
      closeCode: null,
      retryAttempt,
      nextRetryAt: null,
      retryStartedAt,
      phaseStartedAt,
    });

    try {
      socket = new WebSocket(buildAuthenticatedWebSocketUrl(accessToken));
    } catch (error) {
      if (isInitialConnectionPhase()) {
        setTerminalState("connection_failed", "network", String(error), null);
      } else {
        scheduleReconnect("network", String(error), null);
      }
      return;
    }

    openTimer = window.setTimeout(() => {
      setTerminalState(
        "connection_failed",
        "handshake_timeout",
        retryAttempt > 0
          ? "Timed out waiting for the WebSocket reconnect."
          : "Timed out waiting for the initial WebSocket connection.",
        null,
      );
    }, openTimeoutMs);

    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      markAccepted();
      void updateConnection({
        status: "waiting_for_session",
        vadState: vadStarted ? "running" : "idle",
        pin: null,
        lastError: null,
        errorKind: null,
        closeCode: null,
        retryAttempt,
        nextRetryAt: null,
        retryStartedAt: null,
        phaseStartedAt: Date.now(),
      });

      socket?.send(JSON.stringify({
        type: "handshake",
        payload: { languages, domain },
      }));
    };

    socket.onmessage = (event) => {
      const message = parseServerMessage(event.data);
      if (!message) return;

      if (isAuthErrorMessage(message)) {
        setTerminalState(
          "auth_error",
          "auth",
          message.message || message.payload?.message || "Server rejected the stream.",
          null,
        );
        return;
      }

      if (isServerErrorMessage(message)) {
        setTerminalState(
          "server_error",
          "server",
          message.message || message.payload?.message || "Server returned an error.",
          null,
        );
        return;
      }

      const pin = getPinFromMessage(message);
      if (pin) {
        markAccepted();
        void updateConnection({
          status: "connected",
          vadState: vadStarted ? "running" : "starting",
          pin,
          lastError: null,
          errorKind: null,
          closeCode: null,
          retryAttempt,
          nextRetryAt: null,
          retryStartedAt: null,
          phaseStartedAt: Date.now(),
        });
      }
    };

    socket.onerror = () => {
      // The close event carries the actionable code/reason.
    };

    socket.onclose = (event) => {
      clearTimer(openTimer);
      openTimer = null;

      if (terminalStatusSet) return;
      if (reconnectPending) return;

      if (manualClose || !shouldReconnect) {
        void updateConnection({
          status: "idle",
          vadState: "idle",
          pin: null,
          lastError: event.reason || null,
          errorKind: null,
          closeCode: event.code,
          retryAttempt: 0,
          nextRetryAt: null,
          retryStartedAt: null,
          phaseStartedAt: Date.now(),
        });
        return;
      }

      const closeInfo = classifyCloseEvent(event);
      if (isInitialConnectionPhase()) {
        setTerminalState(
          closeInfo.terminalStatus,
          closeInfo.errorKind,
          closeInfo.detail,
          event.code,
        );
        return;
      }

      if (!closeInfo.retryable) {
        setTerminalState(
          closeInfo.terminalStatus,
          closeInfo.errorKind,
          closeInfo.detail,
          event.code,
        );
        return;
      }

      scheduleReconnect(closeInfo.errorKind as RetryableErrorKind, closeInfo.detail, event.code);
    };
  };

  accessToken = await getStoredAccessToken() ?? "";
  if (!accessToken) {
    setTerminalState("auth_error", "auth", "Missing OAuth access token.", null);
    return;
  }

  await connect();
  if (terminalStatusSet) return;

  void updateConnection({ vadState: "starting" });

  try {
    const vad = await setupVAD({
      sendToServer: (audio: Float32Array, end: boolean) => {
        if (socket?.readyState === WebSocket.OPEN) {
          const header = new Uint8Array([end ? 1 : 0]);
          socket.send(new Blob([header, audio.buffer as ArrayBuffer]));
        }
      },
    });

    if (terminalStatusSet) return;
    await vad.start();
    vadStarted = true;
    void updateConnection({ vadState: "running" });
  } catch (error) {
    void updateConnection({
      vadState: "failed",
      lastError: String(error),
      errorKind: "vad",
      phaseStartedAt: Date.now(),
    });
  }

  window.addEventListener("beforeunload", () => {
    manualClose = true;
    shouldReconnect = false;
    clearAllTimers();
    socket?.close();
  });

  window.addEventListener("offline", () => {
    if (manualClose || terminalStatusSet) return;
    scheduleReconnect("network", "Browser went offline during the WebSocket connection.", null);
    socket?.close();
  });

  window.addEventListener("online", () => {
    if (manualClose || terminalStatusSet || !reconnectPending) return;
    clearAllTimers();
    reconnectPending = false;
    retryAttempt += 1;
    void connect();
  });
}

initVAD().catch((err) => {
  const detail = String(err);
  void setConnectionState({
    status: "connection_failed",
    vadState: "failed",
    lastError: detail,
    errorKind: "vad",
    nextRetryAt: null,
    phaseStartedAt: Date.now(),
  });
  void notifyInitialConnectionResult(false, detail);
  void closeOffscreenPreservingConnectionState();
});
