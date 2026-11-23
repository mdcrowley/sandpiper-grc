// Field work's stack (wave 15, E38-11 and E38-12): the list, an inspection run, a condition assessment
// and counting mode. Owner: W15-OFFLINE. The screens are in src/inspections and src/counts.
import { router, Stack, useCanGoBack } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { HEADER_TITLE_SIZE, useTheme } from '../../src/theme';

/** The first screen of a stack opened from a tab has no back button of its own. */
function Back() {
  const { colors } = useTheme();
  if (!useCanGoBack()) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ minHeight: 48, minWidth: 48, justifyContent: 'center' }}>
      <Text style={{ color: colors.brand, fontSize: 17 }}>Back</Text>
    </Pressable>
  );
}

export default function Layout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: true, headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, headerTitleStyle: { color: colors.text, fontSize: HEADER_TITLE_SIZE }, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" options={{ title: 'Field work', headerLeft: () => <Back /> }} />
      <Stack.Screen name="inspection/[id]" options={{ title: 'Inspection' }} />
      <Stack.Screen name="condition" options={{ title: 'Condition assessment' }} />
      <Stack.Screen name="count/[id]" options={{ title: 'Counting' }} />
    </Stack>
  );
}
