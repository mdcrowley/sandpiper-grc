// Account > Devices in the app (spec §5.2 step 5, E38-09): the person's signed-in phones; sign out any
// other one. Signing out this phone is the Sign out button on Account. Owner: APP-CORE.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import type { DeviceView } from '../../../../shared/mobile-api.ts';
import { apiFetch, ApiError } from '../../../src/api/client';
import { commonText } from '../../../src/text/common';
import { accountText } from '../../../src/text/account';
import { useTheme } from '../../../src/theme';
import { Banner, Body, Button, Loading, Row, Screen, Section } from '../../../src/ui';

const T = accountText.devicesScreen;

export default function DevicesScreen() {
  const { colors } = useTheme();
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setDevices(await apiFetch<DeviceView[]>('/api/me/devices'));
    } catch {
      setFailed(true);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  function confirmRevoke(d: DeviceView) {
    Alert.alert(T.signOutDeviceTitle(d.name), T.signOutDeviceBody, [
      { text: accountText.cancel, style: 'cancel' },
      {
        text: T.signOutDevice,
        style: 'destructive',
        onPress: () => {
          apiFetch(`/api/me/devices/${encodeURIComponent(d.id)}`, { method: 'DELETE' })
            .catch((e) => { if (!(e instanceof ApiError && e.status === 404)) setFailed(true); })
            .finally(() => void load());
        },
      },
    ]);
  }

  if (!devices && !failed) return <Loading label={commonText.loading} />;
  const active = (devices ?? []).filter((d) => !d.revokedAt);

  return (
    <Screen>
      <Body muted>{T.intro}</Body>
      {failed ? (
        <>
          <Banner kind="error">{T.loadFailed}</Banner>
          <Button label={T.retry} kind="secondary" onPress={() => void load()} />
        </>
      ) : null}
      {devices && active.length === 0 ? <Body>{T.none}</Body> : null}
      {active.length > 0 ? (
        <Section>
          {active.map((d, i) => (
            <Row
              key={d.id}
              label={d.current ? `${d.name} (${T.thisDevice})` : d.name}
              detail={[
                `${d.platform === 'ios' ? 'iOS' : 'Android'} · ${d.appVersion}`,
                d.lastUsedAt ? T.lastUsed(commonText.ago(d.lastUsedAt)) : T.neverUsed,
              ].join('\n')}
              right={d.current ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${T.signOutDevice} ${d.name}`}
                  onPress={() => confirmRevoke(d)}
                  hitSlop={8}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.dangerText, fontSize: 16, fontWeight: '600' }}>{T.signOutDevice}</Text>
                </Pressable>
              )}
              last={i === active.length - 1}
            />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
