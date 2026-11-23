// Registering for push (E38-14): the right service per platform, the native token only, FCM falling
// back to UnifiedPush in a build without google-services.json, and taps opening Notifications.
import type { PushRegistrationInput, PushStatus } from '../../../shared/push-api.ts';
import { normalizeToken, opensNotifications, registerPhone, type RegistrationDeps } from './registration';

const status = (providers: Partial<PushStatus['providers']>, vapid: string | null = null): PushStatus => {
  const p = { apns: false, fcm: false, unifiedpush: false, ...providers };
  return { available: Object.values(p).some(Boolean), providers: p, vapidPublicKey: vapid, registered: false, provider: null };
};

function deps(over: Partial<RegistrationDeps> & { s: PushStatus }): RegistrationDeps & { sent: PushRegistrationInput[] } {
  const sent: PushRegistrationInput[] = [];
  return {
    platform: 'android', dev: false,
    status: async () => over.s,
    register: async (input) => {
      sent.push(input);
      return over.s;
    },
    deviceToken: async () => 'native-token-0123456789',
    unifiedPush: null,
    ...over,
    sent,
  };
}

describe('registerPhone', () => {
  it('sends the iPhone\'s APNs token with its environment', async () => {
    const d = deps({ platform: 'ios', dev: true, s: status({ apns: true }), deviceToken: async () => '<AB12 CD34>' });
    expect(await registerPhone(d)).toEqual({ ok: true, provider: 'apns' });
    expect(d.sent).toEqual([{ provider: 'apns', token: 'ab12cd34', environment: 'sandbox' }]);
  });

  it('uses the FCM token on Android when the server and the build support it', async () => {
    const d = deps({ s: status({ fcm: true, unifiedpush: true }, 'BKEY') });
    expect(await registerPhone(d)).toEqual({ ok: true, provider: 'fcm' });
    expect(d.sent).toEqual([{ provider: 'fcm', token: 'native-token-0123456789' }]);
  });

  it('falls back to UnifiedPush when there is no Firebase in the build', async () => {
    const d = deps({
      s: status({ fcm: true, unifiedpush: true }, 'BKEY'),
      deviceToken: async () => { throw new Error('Default FirebaseApp is not initialized'); },
      unifiedPush: { register: async (key) => ({ endpoint: `https://push.example.org/up/${key}`, p256dh: 'P', auth: 'A' }), unregister: async () => undefined },
    });
    expect(await registerPhone(d)).toEqual({ ok: true, provider: 'unifiedpush' });
    expect(d.sent).toEqual([{ provider: 'unifiedpush', endpoint: 'https://push.example.org/up/BKEY', p256dh: 'P', auth: 'A' }]);
  });

  it('says when push is not available for this phone', async () => {
    expect(await registerPhone(deps({ s: status({}) }))).toEqual({ ok: false, reason: 'unavailable' });
    expect(await registerPhone(deps({ platform: 'ios', s: status({ fcm: true }) }))).toEqual({ ok: false, reason: 'unavailable' });
    // UnifiedPush on the server, but this build has no connector.
    expect(await registerPhone(deps({ s: status({ unifiedpush: true }, 'BKEY') }))).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('reports a failure without throwing', async () => {
    const d = deps({ s: status({ apns: true }), platform: 'ios', register: async () => { throw new Error('offline'); } });
    expect(await registerPhone(d)).toEqual({ ok: false, reason: 'failed', message: 'offline' });
  });
});

describe('helpers', () => {
  it('normalizes tokens and opens Notifications on a tap', () => {
    expect(normalizeToken('apns', 'AB CD')).toBe('abcd');
    expect(normalizeToken('fcm', ' x:Y ')).toBe('x:Y');
    expect(opensNotifications({ kind: 'unread', count: 2, route: '/notifications' })).toBe(true);
    expect(opensNotifications(undefined)).toBe(true);
    expect(opensNotifications({ kind: 'other', route: '/elsewhere' })).toBe(false);
  });
});
