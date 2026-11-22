// The Tag tab's stack (E38-05): the camera, then the tag card and what it leads to. Owner: APP-CAMERA.
import { Stack } from 'expo-router';
import { useTheme } from '../../../src/theme';

export default function Layout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" options={{ title: 'Tag', headerShown: false }} />
      <Stack.Screen name="card" options={{ title: 'Tag card' }} />
      <Stack.Screen name="attach" options={{ title: 'Attach tag' }} />
      <Stack.Screen name="replace" options={{ title: 'Replace tag' }} />
      <Stack.Screen name="update" options={{ title: 'Quick update' }} />
    </Stack>
  );
}
