// Shown instead of the shell while the server refuses everything except second-factor set-up
// (setting auth.mfa_enforcement = required and the user has no factor yet). Only the account
// security page is offered, with a way to sign out. No metadata is loaded: the server would
// refuse it. As soon as the factor is confirmed the page calls `refresh()` and the shell appears.
import { ActionIcon, Tooltip } from '@mantine/core';
import { useAuth } from './auth';
import { Icon } from './Icon';
import { Wordmark } from './Logo';
import { modules } from './module';
import { useTheme } from './theme';
import { Button, EmptyState } from './ui';

/** The route every installation uses for a person's own sign-in security (the admin module's page). */
export const ACCOUNT_SECURITY_PATH = '/account/security';

export function EnrolmentGate() {
  const { user, appName, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const page = modules.flatMap((m) => m.routes ?? []).find((r) => r.path === ACCOUNT_SECURITY_PATH);
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <div className="gate">
      <header className="gate-bar">
        <span className="gate-brand"><Wordmark name={appName} size={30} /></span>
        <div className="gate-actions">
          {user && <span className="gate-user muted">Signed in as {user.displayName}</span>}
          <Tooltip label={themeLabel}>
            <ActionIcon size={36} className="ui-btn-ghost" onClick={toggle} aria-label={themeLabel}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
            </ActionIcon>
          </Tooltip>
          <Button icon="logout" onClick={() => void logout()}>Sign out</Button>
        </div>
      </header>
      <main id="main" className="content gate-content" tabIndex={-1}>
        <div className="notice notice-warn gate-notice" role="status">
          <Icon name="shield" size={18} />
          <div>
            <strong>Set up a second sign-in factor to continue.</strong>
            <p>
              Your organisation requires one for your account. Until it is set up, the rest of the
              application is not available. It takes about two minutes and needs an authenticator app on your phone.
            </p>
          </div>
        </div>
        {page ? page.element : (
          <EmptyState
            icon="lock"
            title="The set-up page is not part of this installation"
            message="Ask an administrator to reset or set up your second factor, then sign in again."
            action={<Button variant="primary" icon="logout" onClick={() => void logout()}>Sign out</Button>}
          />
        )}
      </main>
    </div>
  );
}
