// My work (E38-04, spec §5.3): everything waiting for the person, from GET /api/mobile/home. Loads
// when the tab opens and when the app returns to the foreground; pull to refresh or the Refresh
// button; the tab's badge shows the total from the last refresh. Owner: APP-WORK.
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { MobileHome, MobileWorkItem, MobileWorkSection } from '../../../../shared/mobile-api.ts';
import { useSession } from '../../api/client';
import { space, useTheme } from '../../theme';
import { fetchHome } from '../api';
import { formatDue } from '../format';
import { useLoad, useMeta, useOnForeground } from '../hooks';
import { workItemTarget } from '../navigate';
import { Body, Button, Card, Chip, Heading, ListRow, Loading, Notice } from '../ui';
import { openOnWeb } from '../web';

export const TEXT = {
  title: 'My work',
  loading: 'Loading your work',
  refresh: 'Refresh',
  refreshHint: 'Loads your work again',
  updated: (time: string) => `Updated ${time}`,
  nothing: 'Nothing waiting.',
  allClear: 'Nothing is waiting for you.',
  waiting: (n: number) => `${n} waiting`,
  overdue: 'Overdue',
  due: (when: string) => `Due ${when}`,
  showAllWeb: (n: number) => `Show all ${n} on the web`,
  openApprovals: 'Open approvals',
  openAcknowledgments: 'Open acknowledgments',
  notifications: (n: number) => (n ? `Notifications (${n} unread)` : 'Notifications'),
  opensWeb: 'Opens on the web',
};

/** The number on the My work tab: everything waiting, as counted at the last refresh. */
export function totalWaiting(home: MobileHome | null): number {
  return home ? home.sections.reduce((n, s) => n + s.count, 0) : 0;
}

export default function WorkScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { session } = useSession();
  const { meta } = useMeta();
  const home = useLoad(fetchHome, [], { auto: false });
  const hasData = useRef(false);
  hasData.current = home.data !== null;

  const refresh = useCallback(() => { void home.reload(hasData.current); }, [home.reload]);
  useFocusEffect(refresh);
  useOnForeground(refresh);

  const total = totalWaiting(home.data);
  useEffect(() => {
    if (!home.data) return;
    // The tab's name starts with its visible label and then says the number (the badge alone was read first).
    navigation.getParent?.()?.setOptions?.({
      tabBarBadge: total > 0 ? (total > 99 ? '99+' : total) : undefined,
      tabBarAccessibilityLabel: total > 0 ? `${TEXT.title}, ${TEXT.waiting(total)}` : TEXT.title,
    });
  }, [navigation, home.data, total]);

  const viewable = (type: string) => Boolean(meta?.resources[type]);
  const open = (section: MobileWorkSection, item: MobileWorkItem) => {
    const target = workItemTarget(section.key, item, viewable);
    if ('app' in target) router.push(target.app as never);
    else void openOnWeb(session?.server, target.web);
  };

  const data = home.data;
  return (
    <ScrollView
      testID="work-screen"
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={home.refreshing} onRefresh={() => void home.reload(true)} tintColor={colors.brand} />}
    >
      <View style={styles.header}>
        {data ? <Body muted>{TEXT.updated(new Date(data.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</Body> : <View />}
        <Button label={TEXT.refresh} hint={TEXT.refreshHint} onPress={() => void home.reload(true)} busy={home.refreshing} />
      </View>
      {home.error ? <Notice>{home.error}</Notice> : null}
      {home.loading && !data ? <Loading label={TEXT.loading} /> : null}
      {data ? (
        <>
          <Button label={TEXT.notifications(data.unreadNotifications)} kind="link" onPress={() => router.push('/notifications' as never)} />
          {total === 0 ? <Notice kind="success">{TEXT.allClear}</Notice> : null}
          {data.sections.map((section) => (
            <Card key={section.key}>
              <View style={styles.sectionHead}>
                <Heading level={2}>{section.label}</Heading>
                <Chip label={TEXT.waiting(section.count)} color={section.count ? 'blue' : 'gray'} />
              </View>
              {section.items.length === 0 ? <Body muted>{TEXT.nothing}</Body> : null}
              {section.items.map((item) => (
                <ListRow
                  key={`${item.type}:${item.id}`}
                  title={item.label}
                  details={[
                    [item.ref, item.status].filter(Boolean).join(' · ') || null,
                    item.overdue ? TEXT.overdue : item.due ? TEXT.due(formatDue(item.due)) : null,
                  ]}
                  right={item.overdue ? <Chip label={TEXT.overdue} color="red" /> : null}
                  onPress={() => open(section, item)}
                />
              ))}
              {section.key === 'approvals' && section.count > 0 ? (
                <Button label={TEXT.openApprovals} onPress={() => router.push('/approvals' as never)} />
              ) : null}
              {section.key === 'acknowledgments' && section.count > 0 ? (
                <Button label={TEXT.openAcknowledgments} onPress={() => router.push('/approvals?show=acknowledgments' as never)} />
              ) : null}
              {section.count > section.items.length ? (
                <Button kind="link" label={TEXT.showAllWeb(section.count)} hint={TEXT.opensWeb} onPress={() => void openOnWeb(session?.server, section.webRoute)} />
              ) : null}
            </Card>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[4] },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  sectionHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
});
