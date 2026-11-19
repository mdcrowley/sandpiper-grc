import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { setLocaleSettings } from './format';
import { resetPreferences } from './preferences';
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
  /** Permission modules of switched-off areas (Administration > Features): nobody holds them. */
  areasOff?: string[];
  pilot: boolean;
  mfaEnrollmentRequired?: boolean;
  mfaEnrollmentBlocked?: boolean;
  mfaGraceEndsAt?: string | null;
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
  /**
   * The second factor is enforced and this user has none: the server refuses everything except
   * setting it up, so the application shows only the set-up page (and sign out).
   */
  mfaEnrollmentBlocked: boolean;
  /** While a grace period runs: the instant (ISO) after which the missing second factor blocks the user. */
  mfaGraceEndsAt: string | null;
  /**
   * True when the user holds the permission, directly or through a wildcard grant (`*`, `tickets.*`).
   * A permission of a switched-off area (Administration > Features) is held by nobody.
   */
  can: (permission: string | undefined) => boolean;
  /** Whether an optional area (`fleet`, `safety`, `portal`, ...) is switched on; unknown keys count as on. */
  areaOn: (key: string) => boolean;
  /** Whether a permission belongs to a switched-off area (so nobody holds it). */
  switchedOff: (permission: string | undefined) => boolean;
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
    const off = new Set(state.areasOff ?? []);
    return {
      user: state.user,
      appName: state.appName || 'Sandpiper GRC',
      setupRequired: state.setupRequired,
      features: state.features ?? {},
      pilot: Boolean(state.pilot),
      mfaEnrollmentRequired: Boolean(state.mfaEnrollmentRequired),
      mfaEnrollmentBlocked: Boolean(state.user && state.mfaEnrollmentBlocked),
      mfaGraceEndsAt: state.mfaGraceEndsAt ?? null,
      can: (permission) => !permission || (!off.has(permission.split('.')[0]) && permits(granted, permission)),
      areaOn: (key) => state.features?.[key] !== false,
      switchedOff: (permission) => Boolean(permission && off.has(permission.split('.')[0])),
      refresh,
      logout: async () => {
        let next: string | null = null;
        try {
          // A session made through a sign-in provider that signs out there too gets that provider's
          // sign-out address back (E02-23); the browser goes there, and the provider sends it back here.
          const res = await api.post<{ ok: boolean; redirectUrl?: string }>('/api/auth/logout');
          next = typeof res?.redirectUrl === 'string' && /^https?:\/\//i.test(res.redirectUrl) ? res.redirectUrl : null;
        } finally {
          resetPreferences();
          if (next) window.location.assign(next);
          else await refresh();
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
