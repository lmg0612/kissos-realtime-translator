import { useEffect, useState } from "react";

import type { CurrentSession } from "../../types/session";

interface Props {
  pin: string | null;
  status: CurrentSession["status"];
  lastError?: string | null;
}

export default function CurrentCard({
  pin,
  status,
  lastError,
}: Props) {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    if (status !== "reconnecting") {
      setDotCount(1);
      return;
    }

    const intervalId = window.setInterval(() => {
      setDotCount((count) => count === 3 ? 1 : count + 1);
    }, 450);

    return () => window.clearInterval(intervalId);
  }, [status]);

  const footerMap: Record<Exclude<CurrentSession["status"], "reconnecting">, string> = {
    idle: "Not Started",
    connecting: "Connecting...",
    handshaking: "Handshaking...",
    connected: "Connected",
    waiting_for_session: "Waiting for session",
    connection_error: "Connection error",
    connection_failed: "Connection failed",
    server_error: "Server error",
    auth_error: "Authentication failed",
    closed: "Connection closed",
    stopping: "Stopping...",
  };

  const footer = status === "reconnecting"
    ? `Reconnecting${".".repeat(dotCount)}`
    : lastError || footerMap[status];

  return (
    <>

      <div className="pinValue">
        {pin ?? "------"}
      </div>

      <div className="cardFooter">
        {footer}
      </div>
    </>
  );
}
