// The My work tab's stack, with headers in the theme's colors. Owner: APP-WORK.
import { Stack } from 'expo-router';
import { headerOptions } from '../../../src/records/header';
import { useTheme } from '../../../src/theme';

export default function Layout() {
  const { colors } = useTheme();
  return <Stack screenOptions={{ ...headerOptions(colors), headerTitle: 'My work' }} />;
}
