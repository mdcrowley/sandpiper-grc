// The Report tab's stack (E38-06): the start screen, the report form and Offline work (E38-10). Owner: APP-CAMERA.
import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

export default function Layout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" options={{ title: 'Report' }} />
      <Stack.Screen name="new" options={{ title: 'New report' }} />
      <Stack.Screen name="offline" options={{ title: 'Offline work' }} />
    </Stack>
  );
}
