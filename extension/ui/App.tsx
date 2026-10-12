import { useCallback, useEffect, useRef, useState } from "react";

import Carousel from "./components/Carousel";
import Navbar from "./components/Navbar";
import LanguageChips from "./components/LanguageChips";
import MicrophoneCard from "./components/MicrophoneCard";
import AccountCard from "./components/AccountCard";
import FirstRunLogin from "./components/FirstRunLogin";
import type { CurrentSession, HistorySession } from "./types/session";
import { UI } from "./constants/ui";
import {
  clearAuthSession,
  formatAuthErrorMessage,
  getAuthSession,
  signIn,
  type AuthSession,
} from "../src/auth";
import {
  CONNECTION_STATE_KEY,
  DEFAULT_CONNECTION_STATE,
  isActiveConnectionStatus,
  isTerminalConnectionStatus,
  normalizeConnectionState,
  type ConnectionState,
} from "../src/connection-state";
import {
  AUTH_STORAGE_KEY,
  DEFAULT_DOMAIN,
  DEFAULT_LANGUAGES,
  FIRST_RUN_COMPLETED_STORAGE_KEY,
  SELECTED_MIC_STORAGE_KEY,
  type OAuthProviderId,
} from "../src/constants";

import "./App.css";

type Tab = "options" | "recents" | "settings";

const HISTORY_STORAGE_KEY = "sessionHistory";
const LAST_ACTIVE_TAB_STORAGE_KEY = "lastActiveTab";
const HISTORY_TTL_MS = 30 * 60 * 1000;
const SHAKE_CLASS = "sett-shake-warning";
const SHAKE_DURATION_MS = 420;

type MicrophonePermissionState = "checking" | "granted" | "prompt" | "denied";

function hasExtensionRuntime() {
  return Boolean(globalThis.chrome?.runtime?.id);
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

function formatExpirationTime(expiresAtMs: number) {
  return new Date(expiresAtMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeHistory(items: unknown): HistorySession[] {
  if (!Array.isArray(items)) return [];

  return items
    .filter((item): item is HistorySession => (
      typeof item === "object" &&
      item !== null &&
      typeof (item as HistorySession).id === "string" &&
      typeof (item as HistorySession).pin === "string" &&
      typeof (item as HistorySession).expiresAtMs === "number"
    ))
    .filter((item) => item.expiresAtMs > Date.now())
    .map((item) => ({
      ...item,
      expiresAt: formatExpirationTime(item.expiresAtMs),
    }));
}

async function saveHistory(history: HistorySession[]) {
  if (hasExtensionRuntime()) {
    await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: history });
  }
}

async function getStoredHistory() {
  if (!hasExtensionRuntime()) return [];

  const result = await chrome.storage.local.get([HISTORY_STORAGE_KEY]);
  const history = normalizeHistory(result[HISTORY_STORAGE_KEY]);
  if (history.length !== (result[HISTORY_STORAGE_KEY] as unknown[] | undefined)?.length) {
    await saveHistory(history);
  }
  return history;
}

function mapConnectionToCurrent(
  connection: ConnectionState | null,
  isRecording: boolean,
  isStopping: boolean,
): CurrentSession {
  if (isStopping) {
    return { pin: connection?.pin ?? null, status: "stopping", lastError: connection?.lastError ?? null };
  }

  if (!isRecording) {
    if (connection && isTerminalConnectionStatus(connection.status)) {
      return { pin: connection.pin, status: connection.status, lastError: connection.lastError };
    }

    return { pin: null, status: "idle", lastError: null };
  }

  const status = connection?.status ?? "connecting";

  return { pin: connection?.pin ?? null, status, lastError: connection?.lastError ?? null };
}

function triggerCardShake(selector: string) {
  requestAnimationFrame(() => {
    const card = document.querySelector(selector);
    if (!card) return;

    card.classList.remove(SHAKE_CLASS);
    void (card as HTMLElement).offsetWidth;
    card.classList.add(SHAKE_CLASS);
    window.setTimeout(() => card.classList.remove(SHAKE_CLASS), SHAKE_DURATION_MS);
  });
}

function getSelectedMicrophoneId() {
  return localStorage.getItem(SELECTED_MIC_STORAGE_KEY) || "";
}

async function checkMicrophonePermission(): Promise<MicrophonePermissionState> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}

function openMicrophoneSetupPage() {
  if (!hasExtensionRuntime()) return;

  const setupUrl = chrome.runtime.getURL("mic-permission.html");
  chrome.tabs.create({ url: setupUrl });
}

function normalizeTab(value: unknown): Tab | null {
  return value === "options" || value === "recents" || value === "settings" ? value : null;
}

function getQueryTab(): Tab | null {
  const params = new URLSearchParams(window.location.search);
  return normalizeTab(params.get("tab"));
}

function getInitialTab(): Tab {
  return getQueryTab() ?? "options";
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab);
  const activeTabRestored = useRef(Boolean(getQueryTab()));
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [firstRunComplete, setFirstRunComplete] = useState<boolean | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [history, setHistory] = useState<HistorySession[]>([]);
  const [connection, setConnection] = useState<ConnectionState>(DEFAULT_CONNECTION_STATE);
  const [current, setCurrent] = useState<CurrentSession>({ pin: null, status: "idle" });
  const [languages, setLanguages] = useState<string[]>([]);
  const [microphonePermission, setMicrophonePermission] =
    useState<MicrophonePermissionState>("checking");
  const [permissionBusy, setPermissionBusy] = useState(false);

  const pruneHistory = useCallback(async () => {
    const next = await getStoredHistory();
    setHistory(next);
    setActiveIndex((index) => Math.min(index, next.length));
  }, []);

  const refreshRuntimeStatus = useCallback(async () => {
    if (!hasExtensionRuntime()) return;

    const [statusResponse, storage, session] = await Promise.all([
      sendRuntimeMessage<{ isRunning: boolean }>({ type: "GET_VAD_STATUS" }),
      chrome.storage.local.get(["selectedLangs", CONNECTION_STATE_KEY, FIRST_RUN_COMPLETED_STORAGE_KEY]),
      getAuthSession(),
    ]);

    const nextConnection = normalizeConnectionState(storage[CONNECTION_STATE_KEY]);
    const selectedLangs = Array.isArray(storage.selectedLangs)
      ? storage.selectedLangs as string[]
      : DEFAULT_LANGUAGES;

    setLanguages(selectedLangs);
    setAuthSession(session);
    setFirstRunComplete(storage[FIRST_RUN_COMPLETED_STORAGE_KEY] !== false || Boolean(session));
    const isRunning =
      !isTerminalConnectionStatus(nextConnection.status) &&
      (statusResponse.isRunning || isActiveConnectionStatus(nextConnection.status));
    setRecording(isRunning);
    if (isTerminalConnectionStatus(nextConnection.status)) {
      setBusy(false);
    }
    setConnection(nextConnection);
    setCurrent(mapConnectionToCurrent(nextConnection, isRunning, false));
  }, []);

  const showAccountGate = useCallback((message = "Sign in to continue.") => {
    setAuthError(message);
    setActiveTab("settings");
    triggerCardShake(".account-card");
  }, []);

  const setAuthFailureConnection = useCallback(async (message: string) => {
    if (!hasExtensionRuntime()) return;

    await chrome.storage.local.set({
      [CONNECTION_STATE_KEY]: {
        ...DEFAULT_CONNECTION_STATE,
        status: "auth_error",
        lastError: message,
        errorKind: "auth",
        updatedAt: Date.now(),
      },
    });
  }, []);

  useEffect(() => {
    void refreshRuntimeStatus();
    void pruneHistory();
    void checkMicrophonePermission().then((permission) => {
      setMicrophonePermission(permission);
    });

    if (!hasExtensionRuntime()) return;

    if (!activeTabRestored.current) {
      chrome.storage.local.get([LAST_ACTIVE_TAB_STORAGE_KEY], (result) => {
        const storedTab = normalizeTab(result[LAST_ACTIVE_TAB_STORAGE_KEY]);
        if (storedTab) {
          setActiveTab(storedTab);
        }
        activeTabRestored.current = true;
      });
    }

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;

      if (changes.selectedLangs) {
        setLanguages(Array.isArray(changes.selectedLangs.newValue)
          ? changes.selectedLangs.newValue
          : DEFAULT_LANGUAGES);
      }

      if (changes[AUTH_STORAGE_KEY]) {
        const nextSession = changes[AUTH_STORAGE_KEY].newValue as AuthSession | undefined;
        setAuthSession(nextSession?.accessToken ? nextSession : null);
      }

      if (changes[FIRST_RUN_COMPLETED_STORAGE_KEY]) {
        setFirstRunComplete(changes[FIRST_RUN_COMPLETED_STORAGE_KEY].newValue !== false);
      }

      if (changes[CONNECTION_STATE_KEY]) {
        const nextConnection = normalizeConnectionState(changes[CONNECTION_STATE_KEY].newValue);
        const isTerminal = isTerminalConnectionStatus(nextConnection.status);
        const isActive = isActiveConnectionStatus(nextConnection.status);
        setConnection(nextConnection);
        if (isTerminal) {
          setRecording(false);
          setBusy(false);
        } else if (isActive) {
          setRecording(true);
        }
        setCurrent((prev) => mapConnectionToCurrent(
          nextConnection,
          isActive || (!isTerminal && prev.status !== "idle"),
          prev.status === "stopping",
        ));
      }

      if (changes[HISTORY_STORAGE_KEY]) {
        const nextHistory = normalizeHistory(changes[HISTORY_STORAGE_KEY].newValue);
        setHistory(nextHistory);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    const historyInterval = window.setInterval(() => void pruneHistory(), 15_000);
    const handleFocus = () => {
      void checkMicrophonePermission().then((permission) => {
        setMicrophonePermission(permission);
      });
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      window.clearInterval(historyInterval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [pruneHistory, refreshRuntimeStatus]);

  useEffect(() => {
    if (!hasExtensionRuntime() || !activeTabRestored.current) return;

    void chrome.storage.local.set({ [LAST_ACTIVE_TAB_STORAGE_KEY]: activeTab });
  }, [activeTab]);

  useEffect(() => {
    setCurrent(mapConnectionToCurrent(connection, recording, current.status === "stopping"));
  }, [connection, recording]);

  const handleLanguagesChange = (nextLanguages: string[]) => {
    setLanguages(nextLanguages);
    if (hasExtensionRuntime()) {
      void chrome.storage.local.set({ selectedLangs: nextLanguages });
    }
  };

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
  };

  const handleSignIn = async (provider: OAuthProviderId) => {
    if (authBusy) return;

    setAuthBusy(true);
    setAuthError(null);

    try {
      const session = await signIn(provider);
      setAuthSession(session);
      setAuthError(null);
      await chrome.storage.local.set({ [FIRST_RUN_COMPLETED_STORAGE_KEY]: true });
      setFirstRunComplete(true);
      const currentConnection = normalizeConnectionState(
        (await chrome.storage.local.get([CONNECTION_STATE_KEY]))[CONNECTION_STATE_KEY],
      );
      if (currentConnection.status === "auth_error") {
        await chrome.storage.local.set({
          [CONNECTION_STATE_KEY]: {
            ...DEFAULT_CONNECTION_STATE,
            updatedAt: Date.now(),
          },
        });
      }
    } catch (error) {
      const message = formatAuthErrorMessage(error);
      setAuthError(message);
      await setAuthFailureConnection(message);
      triggerCardShake(".account-card");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (authBusy) return;

    setAuthBusy(true);
    setAuthError(null);

    try {
      if (recording) {
        await sendRuntimeMessage({ type: "STOP_VAD" }).catch(() => undefined);
      }
      await clearAuthSession();
      await chrome.storage.local.remove(["recordingStartTime"]);
      await chrome.storage.local.set({
        [CONNECTION_STATE_KEY]: {
          ...DEFAULT_CONNECTION_STATE,
          updatedAt: Date.now(),
        },
      });
      setAuthSession(null);
      setRecording(false);
      setBusy(false);
      setCurrent({ pin: null, status: "idle", lastError: null });
      setActiveTab("settings");
    } finally {
      setAuthBusy(false);
    }
  };

  const appendHistory = async (pin: string) => {
    const expiresAtMs = Date.now() + HISTORY_TTL_MS;
    const nextHistory = [
      {
        id: crypto.randomUUID(),
        pin,
        expiresAt: formatExpirationTime(expiresAtMs),
        expiresAtMs,
      },
      ...history,
    ];

    const normalized = normalizeHistory(nextHistory);
    setHistory(normalized);
    setActiveIndex(0);
    await saveHistory(normalized);
  };

  const handleRequestMicrophonePermission = async () => {
    if (permissionBusy) return;

    setPermissionBusy(true);
    openMicrophoneSetupPage();
    window.setTimeout(() => setPermissionBusy(false), 500);
  };

  const startRecording = async () => {
    if (busy) return;

    const session = authSession ?? await getAuthSession();
    if (!session) {
      showAccountGate("Sign in to start recording.");
      return;
    }
    setAuthSession(session);

    const permission = await checkMicrophonePermission();
    setMicrophonePermission(permission);
    if (permission !== "granted") {
      return;
    }

    if (languages.length === 0) {
      setActiveTab("options");
      triggerCardShake(".language-panel");
      return;
    }

    if (!getSelectedMicrophoneId()) {
      setActiveTab("options");
      triggerCardShake(".microphone-card");
      return;
    }

    if (!hasExtensionRuntime()) return;

    setBusy(true);
    setCurrent({ pin: connection.pin, status: "connecting", lastError: null });
    setActiveTab("recents");

    try {
      await sendRuntimeMessage({
        type: "START_VAD",
        payload: {
          languages,
          domain: DEFAULT_DOMAIN,
          accessToken: session.accessToken,
        },
      });
      await refreshRuntimeStatus();
    } catch {
      setRecording(false);
      setCurrent({ pin: null, status: "connection_failed", lastError: null });
      await refreshRuntimeStatus();
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async () => {
    if (busy || !hasExtensionRuntime()) return;

    const pin = current.pin;
    setBusy(true);
    setCurrent({ pin, status: "stopping", lastError: null });

    try {
      await sendRuntimeMessage({ type: "STOP_VAD" });
      if (pin) {
        await appendHistory(pin);
      }
      await refreshRuntimeStatus();
    } catch (error) {
      console.error("Failed to stop recording:", error);
      setCurrent({ pin, status: "connection_failed", lastError: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const showFirstRun = firstRunComplete === false && !authSession;

  return (
    <div
      className="popup"
      style={{
        width: UI.POPUP_WIDTH,
      }}
    >
      {showFirstRun ? (
        <FirstRunLogin
          busy={authBusy}
          error={authError}
          onSignIn={handleSignIn}
        />
      ) : (
      <div className={
        authSession && microphonePermission !== "granted"
          ? "popupContent permissionBlurred"
          : "popupContent"
      }>
        <Navbar
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />

        {activeTab === "options" && (
          <>
            <MicrophoneCard />
            <LanguageChips value={languages} onChange={handleLanguagesChange} />
          </>
        )}

        {activeTab === "recents" && (
          <Carousel
            current={current}
            history={history}
            activeIndex={activeIndex}
            onSelect={setActiveIndex}
          />
        )}

        {activeTab === "settings" && (
          <div className="tabContent settingsContent">
            <AccountCard
              session={authSession}
              busy={authBusy}
              error={authError || (connection.status === "auth_error" ? connection.lastError : null)}
              onSignIn={handleSignIn}
              onSignOut={handleSignOut}
            />
          </div>
        )}

        {activeTab !== "settings" && (
          <button
            className="recordButton"
            disabled={busy}
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? "Stop Recording" : "Start Recording"}
          </button>
        )}
      </div>
      )}

      {!showFirstRun && authSession && microphonePermission !== "granted" && (
        <div className="permissionOverlay" role="dialog" aria-modal="true" aria-labelledby="permission-title">
          <div className="permissionDialog">
            <h2 id="permission-title" className="permissionTitle">Microphone Access</h2>
            <p className="permissionCopy">
              Allow microphone access to start recording.
            </p>
            <button
              type="button"
              className="permissionButton"
              disabled={permissionBusy || microphonePermission === "checking"}
              onClick={handleRequestMicrophonePermission}
            >
              {permissionBusy || microphonePermission === "checking"
                ? "Checking..."
                : "Allow Microphone"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
