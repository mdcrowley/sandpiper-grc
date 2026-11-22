// Restricted records (spec §5.8): while one is on screen, Android blocks screenshots and screen
// recording (FLAG_SECURE) and iOS shows a blank image in the app switcher. Owner: APP-WORK.
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';

const KEY = 'restricted-record';
const ignore = () => {};

/** Protects the screen while `on` is true (a restricted record is open). */
export function useSecureScreen(on: boolean): void {
  useEffect(() => {
    if (!on) return undefined;
    ScreenCapture.preventScreenCaptureAsync(KEY).catch(ignore);
    // Full blur: the app switcher shows a blank image instead of the record.
    if (Platform.OS === 'ios') ScreenCapture.enableAppSwitcherProtectionAsync(1).catch(ignore);
    return () => {
      ScreenCapture.allowScreenCaptureAsync(KEY).catch(ignore);
      if (Platform.OS === 'ios') ScreenCapture.disableAppSwitcherProtectionAsync().catch(ignore);
    };
  }, [on]);
}
