import type { OAuthProviderId } from "../../src/constants";
import { OAUTH_PROVIDERS } from "../../src/constants";

import "./FirstRunLogin.css";

interface Props {
  busy: boolean;
  error: string | null;
  onSignIn: (provider: OAuthProviderId) => void;
}

export default function FirstRunLogin({ busy, error, onSignIn }: Props) {
  const provider = OAUTH_PROVIDERS.google;

  return (
    <main className="first-run">
      <section className="first-run__content" aria-labelledby="first-run-title">
        <div className="first-run__mark" aria-hidden="true">M</div>
        <div className="first-run__copy">
          <h1 id="first-run-title" className="first-run__title">Sign in to start recording</h1>
          <p className="first-run__text">
            Keep your recording sessions connected to your account.
          </p>
        </div>
      </section>

      <section className="first-run__panel" aria-label="Sign in">
        {error && <p className="first-run__error">{error}</p>}
        <button
          type="button"
          className="first-run__button"
          disabled={busy}
          onClick={() => onSignIn("google")}
        >
          {busy ? "Signing in..." : `Continue with ${provider.label}`}
        </button>
      </section>
    </main>
  );
}
