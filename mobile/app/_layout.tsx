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
import { startPush } from '../src/push';
import { setLanguage, useLanguage } from '../src/i18n';
import { loadLanguage } from '../src/i18n/preference';
import { commonText } from '../src/text/common';
import { notificationsText } from '../src/text/notifications';
import { HEADER_TITLE_SIZE, useTheme } from '../src/theme';
import { Loading } from '../src/ui';

export default function RootLayout() {
  const auth = useAuthState();
  const { colors, scheme } = useTheme();
  const segments = useSegments();
  const router = useRouter();
  // E41-07: the screens are drawn again in the person's language when it changes.
  const lang = useLanguage();

  useEffect(() => {
    void start();
    startPush();
  }, []);
  useEffect(() => {
    if (auth.status === 'signed-in') void loadLanguage();
    else if (auth.status === 'signed-out') setLanguage(null);
  }, [auth.status]);

  const inAuth = segments[0] === '(auth)';
  const covered = auth.status === 'loading' || (auth.status === 'signed-in' && auth.locked);
  useEffect(() => {
    if (auth.status === 'loading') return;
    if (auth.status === 'signed-out' && !inAuth) router.replace('/connect');
    else if (auth.status === 'signed-in' && inAuth) router.replace('/work');
  }, [auth.status, inAuth, router]);

  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {/* While the app is locked or loading, the screens under the cover are hidden from VoiceOver and TalkBack and take no touch, key or Switch Access input. */}
        <View key={lang} style={{ flex: 1 }} pointerEvents={covered ? 'none' : 'auto'} importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={covered}>
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.brand,
            headerTitleStyle: { color: colors.text, fontSize: HEADER_TITLE_SIZE },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="notifications" options={{ headerShown: true, title: notificationsText.title }} />
        </Stack>
        </View>
        {auth.status === 'loading' ? <View style={{ position: 'absolute', inset: 0 }}><Loading label={commonText.loading} /></View> : null}
        {auth.status === 'signed-in' && auth.locked ? <LockScreen /> : null}
      </View>
    </SafeAreaProvider>
  );
}
