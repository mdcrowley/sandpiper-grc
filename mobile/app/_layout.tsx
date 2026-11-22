// The app's root: the tabs, sign-in screens and the screens opened from them. Owner: APP-CORE.
// Sends the person to Connect while signed out and covers the app while the unlock is asked.
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuthState } from '../src/api/client';
import { LockScreen } from '../src/auth/LockScreen';
import { start } from '../src/auth/session';
import { commonText } from '../src/text/common';
import { notificationsText } from '../src/text/notifications';
import { useTheme } from '../src/theme';
import { Loading } from '../src/ui';

export default function RootLayout() {
  const auth = useAuthState();
  const { colors, scheme } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void start();
  }, []);

  const inAuth = segments[0] === '(auth)';
  useEffect(() => {
    if (auth.status === 'loading') return;
    if (auth.status === 'signed-out' && !inAuth) router.replace('/connect');
    else if (auth.status === 'signed-in' && inAuth) router.replace('/work');
  }, [auth.status, inAuth, router]);

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.brand,
            headerTitleStyle: { color: colors.text },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="notifications" options={{ headerShown: true, title: notificationsText.title }} />
        </Stack>
        {auth.status === 'loading' ? <View style={{ position: 'absolute', inset: 0 }}><Loading label={commonText.loading} /></View> : null}
        {auth.status === 'signed-in' && auth.locked ? <LockScreen /> : null}
      </View>
    </SafeAreaProvider>
  );
}
