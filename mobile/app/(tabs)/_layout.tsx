// The five tabs (spec §5.3). Owner: APP-CORE. Each tab is a folder with its own stack and owner:
// work and search: APP-WORK; tag and report: APP-CAMERA; account: APP-CORE.
// Tabs of switched-off areas are hidden: Tag while Asset tags is off; Report unless the person may
// report a problem (service desk) or a hazard (safety), uses the self-service portal, or may do field
// work (inspections, condition assessments or counts; the Report tab holds Field work).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Text } from 'react-native';
import { useSession } from '../../src/api/client';
import { tabsText as T } from '../../src/text/tabs';
import { useTheme } from '../../src/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) => (p: { color: unknown; size: number }) => <Ionicons name={name} color={p.color as string} size={p.size} />;

/** Whether the Report tab has anything to offer this person (mirrors the report screens' own choices). */
export function canReport(s: { areaOn(a: string): boolean; can(p: string): boolean }): boolean {
  return (s.areaOn('tickets') && s.can('tickets.create'))
    || (s.areaOn('safety') && s.can('safety.create'))
    || (s.areaOn('portal') && s.can('portal.create'))
    || (s.areaOn('audits') && s.can('audits.view'))
    || (s.areaOn('condition') && s.can('assets.create'))
    || (s.areaOn('tags') && s.can('tags.count'));
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const session = useSession();
  const showTag = session.areaOn('tags');
  const showReport = canReport(session);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        // Labels grow with the phone's text size up to 1.4 times, so five fit side by side at 200%.
        tabBarLabel: ({ children, color }) => <Text maxFontSizeMultiplier={1.4} numberOfLines={1} style={{ color, fontSize: 12 }}>{children}</Text>,
      }}
    >
      <Tabs.Screen name="work" options={{ title: T.work, tabBarAccessibilityLabel: T.work, tabBarIcon: icon('briefcase-outline') }} />
      <Tabs.Screen name="tag" options={{ title: T.tag, tabBarAccessibilityLabel: T.tag, tabBarIcon: icon('scan-outline'), href: showTag ? undefined : null }} />
      <Tabs.Screen name="report" options={{ title: T.report, tabBarAccessibilityLabel: T.report, tabBarIcon: icon('warning-outline'), href: showReport ? undefined : null }} />
      <Tabs.Screen name="search" options={{ title: T.search, tabBarAccessibilityLabel: T.search, tabBarIcon: icon('search-outline') }} />
      <Tabs.Screen name="account" options={{ title: T.account, tabBarAccessibilityLabel: T.account, tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
