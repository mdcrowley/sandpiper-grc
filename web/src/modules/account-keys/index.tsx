// Passkeys and security keys (E02-08) and the setup wizard's second-factor choice (E02-17).
// Embeddable pieces for other screens: PasskeysCard (Account security, a user's page),
// PasskeySignIn and PasskeySecondFactorButton (the sign-in page), SecondFactorChoice (setup).
import type { ModuleDef } from '../../core';
import { PasskeySignInPage, PasskeysPage } from './pages';

const mod: ModuleDef = {
  key: 'account-keys',
  routes: [
    // "My account": open to every signed-in user.
    { path: '/account/passkeys', element: <PasskeysPage /> },
  ],
  publicRoutes: [
    { path: '/sign-in/passkey', element: <PasskeySignInPage /> },
  ],
};
export default mod;
