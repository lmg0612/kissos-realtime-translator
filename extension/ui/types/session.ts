import type { ConnectionStatus } from "../../src/connection-state";

export interface CurrentSession {
  pin: string | null;
  status: ConnectionStatus | "stopping";
  lastError?: string | null;
}

export interface HistorySession {
  id: string;
  pin: string;
  expiresAt: string;
  expiresAtMs: number;
}
