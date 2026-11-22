// The Account tab (spec §5.3, E38-09): who and which server, notifications, devices, the unlock,
// sign out, about and open-source licenses. Owner: APP-CORE. Text: src/text/account.ts.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Switch } from 'react-native';
import { apiFetch, useAuthState, useSession } from '../../../src/api/client';
import { appVersion, setUnlockPreference, signOut, unlockAvailable, unsentWorkCount } from '../../../src/auth/session';
import { accountText as T } from '../../../src/text/account';
import { useTheme } from '../../../src/theme';
import { Banner, Body, Button, Row, Screen, Section } from '../../../src/ui';

export default function AccountScreen() {
  const { session } = useSession();
  const auth = useAuthState();
  const { colors } = useTheme();
  const router = useRouter();
  const [unread, setUnread] = useState<number | null>(null);
  const [canUnlock, setCanUnlock] = useState(true);

  useFocusEffect(useCallback(() => {
    let live = true;
    apiFetch<{ unread: number }>('/api/notifications/unread-count')
      .then((r) => live && setUnread(r.unread))
      .catch(() => live && setUnread(null));
    return () => {
      live = false;
    };
  }, []));

  useEffect(() => {
    void unlockAvailable().then(setCanUnlock);
  }, []);

  if (!session) return null;
  const required = !!auth.profile?.unlock.required;
  const afterMinutes = auth.profile?.unlock.afterMinutes ?? 5;

  async function confirmSignOut() {
    const unsent = await unsentWorkCount();
    Alert.alert(T.signOutTitle, unsent > 0 ? T.signOutUnsent(unsent) : T.signOutBody, [
      { text: T.cancel, style: 'cancel' },
      { text: T.signOut, style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <Screen>
      <Section title={T.sections.you}>
        <Row label={T.signedInAs} value={session.user.displayName} />
        <Row label={T.username} value={session.user.username} />
        <Row label={T.server} value={session.server.replace(/^https?:\/\//, '')} last />
      </Section>

      <Section>
        <Row
          label={T.notifications}
          value={unread ? T.notificationsUnread(unread) : null}
          onPress={() => router.push('/notifications')}
        />
        <Row label={T.devices} detail={T.devicesDetail} onPress={() => router.push('/account/devices')} last />
      </Section>

      <Section title={T.sections.security}>
        <Row
          label={T.unlock}
          detail={required ? `${T.unlockRequired} ${T.unlockDetail(afterMinutes)}` : canUnlock ? T.unlockDetail(afterMinutes) : T.unlockUnavailable}
          right={(
            <Switch
              accessibilityLabel={T.unlock}
              value={required || auth.prefs.unlock}
              disabled={required || !canUnlock}
              onValueChange={(on) => void setUnlockPreference(on)}
              trackColor={{ true: colors.brand, false: colors.borderControl }}
            />
          )}
          last
        />
      </Section>

      <Section title={T.sections.about}>
        <Row label={T.version} value={appVersion()} />
        <Row label={T.licenses} onPress={() => router.push('/account/licenses')} last />
      </Section>
      {auth.updateSuggested ? <Banner kind="info">{T.update}</Banner> : null}
      <Body muted>{T.privacy}</Body>

      <Button label={T.signOut} kind="danger" onPress={() => void confirmSignOut()} />
    </Screen>
  );
}
