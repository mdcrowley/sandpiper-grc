// The Report tab's stack (E38-06): the start screen and the report form. Owner: APP-CAMERA.
import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

export default function Layout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" options={{ title: 'Report' }} />
      <Stack.Screen name="new" options={{ title: 'New report' }} />
    </Stack>
  );
}
