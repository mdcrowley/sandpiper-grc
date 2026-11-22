// The Account tab's stack: Account, Devices, Open-source licenses. Owner: APP-CORE.
import { Stack } from 'expo-router';
import { accountText as T } from '../../../src/text/account';
import { useTheme } from '../../../src/theme';

export default function Layout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.brand,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: T.title }} />
      <Stack.Screen name="devices" options={{ title: T.devicesScreen.title }} />
      <Stack.Screen name="licenses" options={{ title: T.licensesScreen.title }} />
    </Stack>
  );
}
