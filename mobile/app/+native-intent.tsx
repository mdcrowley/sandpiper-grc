// Links that open the app (expo-router's native intent hook). The sign-in redirect
// `com.sandpipergrc:/oauth?code=...` is read by the browser sheet in src/auth/session.ts; on Android it
// also reaches the router, which must not try to open it as a screen: it stays on Connect, and the
// root layout moves on to My work once the sign-in has finished.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(com\.sandpipergrc:)?\/*oauth(\?|$)/.test(path) ? '/connect' : path;
}
