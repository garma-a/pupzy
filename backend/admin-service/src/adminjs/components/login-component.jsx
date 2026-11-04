import React, { useState } from 'react';
import { useTranslation } from 'adminjs';

export default function Login() {
  const { action, errorMessage } = typeof window !== 'undefined' ? (window.__APP_STATE__ ?? {}) : {};
  const { translateMessage } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const error = errorMessage ? (errorMessage.includes(' ') ? errorMessage : translateMessage(errorMessage)) : null;
  return (
    <main className="pupzy-login">
      <div className="pupzy-login-card">
        <section className="pupzy-login-intro">
          <h1>Welcome to Pupzy</h1>
          <p>Review Posts, follow reports and help keep the community safe.</p>
          <svg
            className="pupzy-login-paw"
            viewBox="0 0 120 120"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <ellipse cx="27" cy="41" rx="10" ry="15" transform="rotate(-30 27 41)" />
            <ellipse cx="49" cy="27" rx="10" ry="15" transform="rotate(-10 49 27)" />
            <ellipse cx="75" cy="28" rx="10" ry="15" transform="rotate(10 75 28)" />
            <ellipse cx="97" cy="44" rx="10" ry="15" transform="rotate(30 97 44)" />
            <path d="M37 72c9-6 12-22 25-22s16 16 25 22c22 22-2 40-25 27-24 13-48-5-25-27Z" />
          </svg>
        </section>
        <form action={action || '/admin/login'} method="POST" onSubmit={() => setSubmitting(true)}>
          <img className="pupzy-login-logo" src="/admin/assets/logo.png" alt="Pupzy" width="4469" height="2849" />
          <h2>Sign in to your workspace</h2>
          <p className="pupzy-login-help">Use your administrator account to continue.</p>
          {error ? (
            <div className="pupzy-login-error" role="alert">
              {error}
            </div>
          ) : null}
          <label htmlFor="pupzy-login-email">Email</label>
          <input id="pupzy-login-email" type="email" name="email" autoComplete="username" spellCheck={false} required />
          <label htmlFor="pupzy-login-password">Password</label>
          <input id="pupzy-login-password" type="password" name="password" autoComplete="current-password" required />
          <button type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
