import {
  CONNECTION_STATE_KEY,
  DEFAULT_CONNECTION_STATE,
  isActiveConnectionStatus,
  isTerminalConnectionStatus,
  normalizeConnectionState,
} from "../connection-state";
import {
  AUTH_ACCESS_TOKEN_STORAGE_KEY,
  DEFAULT_DOMAIN,
  DEFAULT_LANGUAGES,
  FIRST_RUN_COMPLETED_STORAGE_KEY,
} from "../constants";

const OFFSCREEN_PATH = "offscreen.html";
const DASHBOARD_RELOAD_DELAY_MS = 700;
const INITIAL_CONNECTION_TIMEOUT_MS = 9_000;

let initialConnectionResolver: ((result: { success: boolean; error?: string }) => void) | null = null;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createTab(createProperties: chrome.tabs.CreateProperties) {
  return new Promise<chrome.tabs.Tab>((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function reloadTab(tabId: number) {
  return new Promise<void>((resolve, reject) => {
    chrome.tabs.reload(tabId, { bypassCache: false }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function openDashboardTab(url: string, reloadAfterOpen = false) {
  const tab = await createTab({ url, active: true });
  if (!reloadAfterOpen || typeof tab.id !== "number") return;

  await wait(DASHBOARD_RELOAD_DELAY_MS);
  await reloadTab(tab.id);
}

async function createOffscreen(languages: string[], domain: string) {
  if (await chrome.offscreen.hasDocument()) return;

  const params = new URLSearchParams();
  params.set("langs", languages.join(","));
  params.set("domain", domain);

  await chrome.offscreen.createDocument({
    url: `${chrome.runtime.getURL(OFFSCREEN_PATH)}?${params.toString()}`,
    reasons: [chrome.offscreen.Reason.WEB_RTC, chrome.offscreen.Reason.USER_MEDIA],
    justification: "VAD voice activity detection requires a DOM environment for audio processing.",
  });
}

function waitForInitialConnectionResult() {
  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    if (initialConnectionResolver) {
      initialConnectionResolver({ success: false, error: "Initial connection was superseded." });
    }

    const timeoutId = setTimeout(() => {
      if (initialConnectionResolver) {
        initialConnectionResolver = null;
        resolve({ success: false, error: "Timed out waiting for the initial connection result." });
      }
    }, INITIAL_CONNECTION_TIMEOUT_MS);

    initialConnectionResolver = (result) => {
      clearTimeout(timeoutId);
      initialConnectionResolver = null;
      resolve(result);
    };
  });
}

async function closeOffscreen() {
  if (await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(["selectedLangs", "selectedDomain"], (result) => {
    const updates: Record<string, unknown> = {};
    if (!Array.isArray(result.selectedLangs)) updates.selectedLangs = DEFAULT_LANGUAGES;
    if (!result.selectedDomain) updates.selectedDomain = DEFAULT_DOMAIN;
    if (details.reason === "install") updates[FIRST_RUN_COMPLETED_STORAGE_KEY] = false;
    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "START_VAD") {
    const startTime = Date.now();
    const languages = Array.isArray(message.payload?.languages)
      ? message.payload.languages
      : DEFAULT_LANGUAGES;
    const domain = typeof message.payload?.domain === "string"
      ? message.payload.domain
      : DEFAULT_DOMAIN;
    const accessToken = typeof message.payload?.accessToken === "string"
      ? message.payload.accessToken
      : "";

    if (!accessToken) {
      chrome.storage.local.set({
        [CONNECTION_STATE_KEY]: {
          ...DEFAULT_CONNECTION_STATE,
          status: "auth_error",
          lastError: "Sign in is required.",
          errorKind: "auth",
          updatedAt: Date.now(),
        },
      }, () => {
        sendResponse({ success: false, error: "Sign in is required." });
      });
      return true;
    }

    chrome.storage.local.set(
      {
        selectedLangs: languages,
        selectedDomain: domain,
        [AUTH_ACCESS_TOKEN_STORAGE_KEY]: accessToken,
        recordingStartTime: startTime,
        [CONNECTION_STATE_KEY]: {
          ...DEFAULT_CONNECTION_STATE,
          status: "connecting",
          updatedAt: Date.now(),
        },
      },
      async () => {
        try {
          await createOffscreen(languages, domain);
          const initialResult = await waitForInitialConnectionResult();
          if (!initialResult.success) {
            await closeOffscreen();
            const storage = await chrome.storage.local.get([CONNECTION_STATE_KEY]);
            const connection = normalizeConnectionState(storage[CONNECTION_STATE_KEY]);
            if (!isTerminalConnectionStatus(connection.status)) {
              await chrome.storage.local.set({
              [CONNECTION_STATE_KEY]: {
                ...DEFAULT_CONNECTION_STATE,
                status: "connection_failed",
                  lastError: initialResult.error || "Initial connection failed.",
                  errorKind: "runtime",
                  updatedAt: Date.now(),
                },
              });
            }
            sendResponse({ success: false, error: initialResult.error || "Initial connection failed." });
            return;
          }

          sendResponse({ success: true, startTime });
        } catch (err) {
          await chrome.storage.local.set({
            [CONNECTION_STATE_KEY]: {
              ...DEFAULT_CONNECTION_STATE,
              status: "connection_failed",
              lastError: String(err),
              errorKind: "runtime",
              updatedAt: Date.now(),
            },
          });
          sendResponse({ success: false, error: String(err) });
        }
      },
    );
    return true;
  }

  if (message.type === "OFFSCREEN_INITIAL_CONNECTION_RESULT") {
    if (initialConnectionResolver) {
      initialConnectionResolver({
        success: Boolean(message.success),
        error: typeof message.error === "string" ? message.error : undefined,
      });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "STOP_VAD") {
    chrome.storage.local.remove(["recordingStartTime", AUTH_ACCESS_TOKEN_STORAGE_KEY], async () => {
      try {
        await closeOffscreen();
        await chrome.storage.local.set({
          [CONNECTION_STATE_KEY]: {
            ...DEFAULT_CONNECTION_STATE,
            updatedAt: Date.now(),
          },
        });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: String(err) });
      }
    });
    return true;
  }

  if (message.type === "CLOSE_OFFSCREEN_PRESERVE_CONNECTION_STATE") {
    closeOffscreen()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "GET_VAD_STATUS") {
    Promise.all([
      chrome.offscreen.hasDocument(),
      chrome.storage.local.get([CONNECTION_STATE_KEY]),
    ]).then(([hasDocument, storage]) => {
      const connection = normalizeConnectionState(storage[CONNECTION_STATE_KEY]);
      sendResponse({
        isRunning: hasDocument && isActiveConnectionStatus(connection.status),
        connectionState: connection,
      });
    });
    return true;
  }

  if (message.type === "STORAGE_GET") {
    chrome.storage.local.get(message.keys, (result) => sendResponse(result));
    return true;
  }

  if (message.type === "STORAGE_SET") {
    chrome.storage.local.set(message.values, () => {
      const lastError = chrome.runtime.lastError;
      sendResponse(lastError ? { success: false, error: lastError.message } : { success: true });
    });
    return true;
  }

  if (message.type === "OPEN_DASHBOARD") {
    const url = message.payload?.url;
    if (typeof url !== "string") {
      sendResponse({ success: false, error: "Dashboard URL is missing." });
      return true;
    }

    openDashboardTab(url, Boolean(message.payload?.reloadAfterOpen))
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  return false;
});
