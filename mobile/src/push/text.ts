// Text of push notifications in the app (Account > Push notifications). Owner: W14-PUSH (E38-14).
export const pushText = {
  section: 'Push notifications',
  label: 'Tell me on this phone',
  detailOn: 'Pushes say only how many notifications are new. Tap one to open Notifications.',
  detailOff: 'Get a push when you have new notifications. The push never says what they are about.',
  unavailable: 'Your organization has not set up push notifications for this kind of phone.',
  denied: 'Notifications are turned off for this app in the phone\'s settings.',
  failed: 'This phone could not be registered for push notifications. Try again later.',
  channelName: 'Notifications',
  channelDescription: 'How many new notifications you have in Sandpiper GRC',
} as const;
