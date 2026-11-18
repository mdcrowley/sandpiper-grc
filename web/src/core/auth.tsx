import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { setLocaleSettings } from './format';
import { ErrorState, Loading } from './ui';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  roles: string[];
}

interface AuthStateResponse {
  appName: string;
  setupRequired: boolean;
  user: AuthUser | null;
  permissions: string[];
  features: Record<string, boolean>;
  pilot: boolean;
  mfaEnrollmentRequired?: boolean;
  timeZone?: string;
  currency?: string;
}

export interface Auth {
  user: AuthUser | null;
  appName: string;
  setupRequired: boolean;
  features: Record<string, boolean>;
  pilot: boolean;
  /** The user's role needs a second sign-in factor that is not set up yet. */
  mfaEnrollmentRequired: boolean;
  /** True when the user holds the permission, directly or through a wildcard grant (`*`, `tickets.*`). */
  can: (permission: string | undefined) => boolean;
  /** Re-read the session from the server. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

/** Does any grant in `granted` cover `permission`? Grants may be `*`, `<module>.*` or exact. */
export function permits(granted: string[], permission: string): boolean {
  return granted.some(
    (g) => g === '*' || g === permission || (g.endsWith('.*') && permission.startsWith(g.slice(0, -1))),
  );
}

const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthProvider');
  return auth;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthStateResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.get<AuthStateResponse>('/api/auth/state');
      setLocaleSettings({ timeZone: next.timeZone, currency: next.currency });
      setState(next);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    setUnauthorizedHandler(() => void refresh());
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const auth = useMemo<Auth | null>(() => {
    if (!state) return null;
    const granted = state.permissions ?? [];
    return {
      user: state.user,
      appName: state.appName || 'Sandpiper GRC',
      setupRequired: state.setupRequired,
      features: state.features ?? {},
      pilot: Boolean(state.pilot),
      mfaEnrollmentRequired: Boolean(state.mfaEnrollmentRequired),
      can: (permission) => !permission || permits(granted, permission),
      refresh,
      logout: async () => {
        try {
          await api.post('/api/auth/logout');
        } finally {
          await refresh();
        }
      },
    };
  }, [state, refresh]);

  if (!auth) {
    return (
      <div className="boot">
        {error
          ? <ErrorState title="The application could not start" error={error} onRetry={() => void refresh()} />
          : <Loading label="Starting" lines={3} />}
      </div>
    );
  }
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}
