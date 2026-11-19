import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, useAuth } from '../../core';
import { Wordmark } from '../../core/Logo';
import './account-keys.css';
import { PasskeysCard } from './PasskeysCard';
import { PasskeySignIn } from './PasskeySignIn';

/** /account/passkeys: the person's own keys on a page of their own (the same card as on Account security). */
export function PasskeysPage() {
  const auth = useAuth();
  return (
    <div className="ak-page">
      <PageHeader
        title="Passkeys and security keys"
        subtitle={auth.user ? `Signed in as ${auth.user.displayName} (${auth.user.username})` : undefined}
        breadcrumbs={[{ label: 'Account security', to: '/account/security' }]}
      />
      <PasskeysCard onChange={() => void auth.refresh()} />
    </div>
  );
}

/** /sign-in/passkey: sign in with a passkey alone, without the password form. */
export function PasskeySignInPage() {
  const { appName, user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (user) navigate('/', { replace: true }); }, [user, navigate]);
  return (
    <main className="auth-page" id="main">
      <div className="auth-card">
        <p className="auth-brand"><Wordmark name={appName} size={32} /></p>
        <p className="auth-tagline">Governance, risk and compliance for transit organisations</p>
        <h1 className="auth-title">Sign in with a passkey</h1>
        <p className="muted">Your browser asks you to choose a passkey saved for this site, then to confirm with your fingerprint, face or device PIN.</p>
        <PasskeySignIn divider={false} primary />
        <p className="auth-foot"><Link to="/">Sign in with your password instead</Link></p>
      </div>
    </main>
  );
}
