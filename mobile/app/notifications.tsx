// The in-app notification list, read state shared with the web (E38-09): the same
// GET /api/notifications the web's bell uses; opening one marks it read for both. Owner: APP-CORE.
// Text: src/text/notifications.ts.
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { apiFetch, ApiError, CLIENT_ERRORS } from '../src/api/client';
import { notificationsPage, type NotificationRow } from '../src/api/notifications';
import { commonText } from '../src/text/common';
import { notificationsText as T } from '../src/text/notifications';
import { fontSize, radius, space, useTheme } from '../src/theme';
import { Banner } from '../src/ui';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (wanted: number) => {
    try {
      const r = await notificationsPage(wanted, unreadOnly);
      setRows((old) => (wanted === 1 ? r.rows : [...old, ...r.rows.filter((n) => !old.some((o) => o.id === n.id))]));
      setPage(wanted);
      setTotal(r.total);
      setUnread(r.unread);
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof ApiError && e.code === CLIENT_ERRORS.offline ? T.offline : T.loadFailed);
    } finally {
      setLoaded(true);
    }
  }, [unreadOnly]);

  useEffect(() => {
    void load(1);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load(1);
    setRefreshing(false);
  }

  async function open(n: NotificationRow) {
    if (!n.read_at) {
      setRows((old) => old.map((o) => (o.id === n.id ? { ...o, read_at: new Date().toISOString() } : o)));
      apiFetch<{ unread: number }>(`/api/notifications/${encodeURIComponent(n.id)}/read`, { method: 'POST' })
        .then((r) => setUnread(r.unread))
        .catch(() => undefined);
    }
    if (!n.unavailable && n.record_type && n.record_id) {
      router.push(`/record/${encodeURIComponent(n.record_type)}/${encodeURIComponent(n.record_id)}`);
    }
  }

  async function markAllRead() {
    try {
      const r = await apiFetch<{ unread: number }>('/api/notifications/read-all', { method: 'POST' });
      setUnread(r.unread);
      const now = new Date().toISOString();
      setRows((old) => (unreadOnly ? [] : old.map((o) => ({ ...o, read_at: o.read_at ?? now }))));
    } catch {
      setProblem(T.loadFailed);
    }
  }

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? colors.brand : colors.surface, borderColor: on ? colors.brand : colors.borderControl }]}
    >
      <Text style={{ color: on ? colors.brandContrast : colors.text, fontSize: fontSize.md, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (unread > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => void markAllRead()} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: colors.link, fontSize: fontSize.lg }}>{T.markAllRead}</Text>
            </Pressable>
          ) : null),
        }}
      />
      <FlatList
        data={rows}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: space[4], gap: space[2], flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.brand} colors={[colors.brand]} />}
        onEndReached={() => { if (rows.length < total) void load(page + 1); }}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={(
          <View style={{ gap: space[3], marginBottom: space[2] }}>
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              {chip(T.showAll, !unreadOnly, () => setUnreadOnly(false))}
              {chip(T.showUnread, unreadOnly, () => setUnreadOnly(true))}
            </View>
            {problem ? <Banner kind="error">{problem}</Banner> : null}
          </View>
        )}
        ListEmptyComponent={loaded && !problem
          ? <Text style={{ color: colors.textMuted, fontSize: fontSize.lg, textAlign: 'center', marginTop: space[6] }}>{unreadOnly ? T.emptyUnread : T.empty}</Text>
          : undefined}
        renderItem={({ item }) => {
          const isUnread = !item.read_at;
          const opens = !item.unavailable && !!item.record_type && !!item.record_id;
          return (
            <Pressable
              accessibilityRole={opens ? 'button' : undefined}
              accessibilityLabel={[isUnread ? T.unreadLabel : null, item.title, item.body, commonText.ago(item.created_at)].filter(Boolean).join(', ')}
              accessibilityHint={opens ? T.openHint : undefined}
              onPress={() => void open(item)}
              style={({ pressed }) => [
                styles.item,
                { backgroundColor: pressed ? colors.surfaceHover : colors.surface, borderColor: isUnread ? colors.brand : colors.border },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                {isUnread ? <View style={[styles.dot, { backgroundColor: colors.brand }]} /> : null}
                <Text style={[styles.title, { color: colors.text, fontWeight: isUnread ? '700' : '500' }]} numberOfLines={2}>
                  {item.unavailable ? T.unavailable : item.title}
                </Text>
              </View>
              {item.body ? <Text style={{ color: colors.textMuted, fontSize: fontSize.md }} numberOfLines={3}>{item.body}</Text> : null}
              <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{commonText.ago(item.created_at)}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 36, paddingHorizontal: space[3], borderRadius: 18, borderWidth: 1, justifyContent: 'center' },
  item: { borderRadius: radius.lg, borderWidth: 1, padding: space[3], gap: space[1], minHeight: 56 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: fontSize.lg, flex: 1 },
});
