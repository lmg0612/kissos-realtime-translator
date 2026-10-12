import type { AuthSession } from "../../src/auth";
import { OAUTH_PROVIDERS, type OAuthProviderId } from "../../src/constants";

import "./AccountCard.css";

interface Props {
  session: AuthSession | null;
  busy: boolean;
  error: string | null;
  onSignIn: (provider: OAuthProviderId) => void;
  onSignOut: () => void;
}

export default function AccountCard({
  session,
  busy,
  error,
  onSignIn,
  onSignOut,
}: Props) {
  const provider = session?.provider ? OAUTH_PROVIDERS[session.provider] : OAUTH_PROVIDERS.google;
  const displayName = session?.user.name || session?.user.email || "Signed in account";

  return (
    <section className="account-card">
      <h2 className="account-card__title">Account</h2>

      <div className="account-card__body">
        {session ? (
          <>
            <div className="account-card__name">{displayName}</div>
            <p className="account-card__meta">{provider.label}</p>
          </>
        ) : (
          <p className="account-card__copy">Sign in to start recording.</p>
        )}
        {error && <p className="account-card__error">{error}</p>}
      </div>

      <div className="account-card__actions">
        {session ? (
          <button
            type="button"
            className="account-card__button account-card__button--secondary"
            disabled={busy}
            onClick={onSignOut}
          >
            Sign out
          </button>
        ) : (
          <button
            type="button"
            className="account-card__button"
            disabled={busy}
            onClick={() => onSignIn("google")}
          >
            {busy ? "Signing in..." : `Continue with ${provider.label}`}
          </button>
        )}
      </div>
    </section>
  );
}
