// Text of the Connect screen (app/(auth)/connect.tsx). One file per screen, so wording is reviewed and
// translated in one place (E38-01).
import type { ConnectProblem } from '../auth/server';

export const connectText = {
  title: 'Connect to your server',
  intro: 'Type the address of your organization\'s Sandpiper GRC server. Your administrator can tell you what it is.',
  addressLabel: 'Server address',
  addressPlaceholder: 'grc.example.org',
  addressHint: 'For example grc.example.org. The app always uses a secure (HTTPS) connection.',
  check: 'Continue',
  checking: 'Checking the server',
  connectedTo: (name: string, server: string) => `${name} at ${server}`,
  signIn: 'Sign in',
  signInHint: 'Opens your organization\'s sign-in page in a secure browser window.',
  changeServer: 'Use another server',
  updateSuggested: 'A newer version of the app is available. Ask your administrator how to update it.',
  canceled: 'Sign-in was canceled.',
  refused: (detail?: string) => `The server did not accept the sign-in${detail ? ` (${detail})` : ''}. Try again.`,
  failed: 'Signing in did not finish. Check your connection and try again.',
  signedOut: {
    refresh_failed: 'You were signed out: this phone\'s session ended or was signed out from Account > Devices. Sign in again.',
    switched_off: 'The mobile app was switched off on your server. Ask your administrator.',
  },
  problems: {
    empty: 'Type the server address.',
    invalid: 'That is not a server address. Type it like grc.example.org.',
    not_https: 'The app only connects over HTTPS. Use the address that starts with https://.',
    unreachable: 'The server cannot be reached. Check the address and your connection.',
    not_sandpiper: 'That address does not answer as a Sandpiper GRC server.',
    switched_off: 'The mobile app is not switched on for this server. Ask your administrator.',
    app_too_old: 'This server needs a newer version of the app. Update the app, then try again.',
    server_too_old: 'This server is older than the app supports. Ask your administrator to update the server.',
  } satisfies Record<ConnectProblem, string>,
} as const;
