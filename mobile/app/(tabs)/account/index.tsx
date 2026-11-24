// The Account tab (spec §5.3, E38-09): who and which server, notifications, devices, the unlock,
// sign out, about and open-source licenses. Owner: APP-CORE. Text: src/text/account.ts.
// Push notifications (E38-14): the switch below, src/push (text in src/push/text.ts).
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { apiFetch, useAuthState, useSession } from '../../../src/api/client';
import { appVersion, setUnlockPreference, signOut, unlockAvailable, unsentWorkCount } from '../../../src/auth/session';
import { changeDistributor, setPushEnabled, startPush, usePushState } from '../../../src/push';
import { pushText as P } from '../../../src/push/text';
import { accountText as T } from '../../../src/text/account';
import { languageChoices, useLanguage } from '../../../src/i18n';
import { chooseLanguage } from '../../../src/i18n/preference';
import { Banner, Body, Button, Row, Screen, Section, SwitchRow } from '../../../src/ui';

export default function AccountScreen() {
  const { session } = useSession();
  const auth = useAuthState();
  const router = useRouter();
  const [unread, setUnread] = useState<number | null>(null);
  const [canUnlock, setCanUnlock] = useState(true);
  const push = usePushState();
  const unifiedPush = push.status === 'on' && push.provider === 'unifiedpush';
  const lang = useLanguage();
  const [languageProblem, setLanguageProblem] = useState(false);

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
    startPush(); // started by the root layout too; calling it again does nothing
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

      <Section title={P.section}>
        <SwitchRow
          label={P.label}
          detail={push.status === 'on' ? P.detailOn : 'message' in push && push.message ? push.message : P.detailOff}
          value={push.status === 'on' || push.status === 'working'}
          disabled={push.status === 'working'}
          onChange={(on) => void setPushEnabled(on)}
          last={!unifiedPush}
        />
        {unifiedPush ? (
          <Row
            label={P.distributor}
            value={push.distributor?.name ?? P.distributorUnknown}
            detail={P.distributorDetail}
            accessibilityHint={P.distributorChange}
            onPress={() => void changeDistributor()}
            last
          />
        ) : null}
      </Section>

      {/* E41-07: the language of the employee-facing screens, kept on the person's account. */}
      <Section title={T.sections.language}>
        {languageChoices().map((l, i, all) => (
          <Row key={l.code} label={l.name} selected={l.code === lang} last={i === all.length - 1}
            onPress={() => { setLanguageProblem(false); chooseLanguage(l.code).catch(() => setLanguageProblem(true)); }} />
        ))}
      </Section>
      <Body muted>{languageProblem ? T.languageFailed : T.languageDetail}</Body>

      <Section title={T.sections.security}>
        <SwitchRow
          label={T.unlock}
          detail={required ? `${T.unlockRequired} ${T.unlockDetail(afterMinutes)}` : canUnlock ? T.unlockDetail(afterMinutes) : T.unlockUnavailable}
          value={required || auth.prefs.unlock}
          disabled={required || !canUnlock}
          onChange={(on) => void setUnlockPreference(on)}
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
