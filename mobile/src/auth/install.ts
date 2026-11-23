// A new installation starts signed out (wave 16, E38-15). On iPhone, Keychain items outlive the app:
// after the app is deleted and installed again, its tokens and installation id would still be there,
// and the person would be signed in again without signing in. A marker file in the app's own folder
// (deleted with the app) tells a new installation from a launch: when it is missing at a launch, the
// Keychain items are removed first. On Android the Keystore and the app's storage go with the app, so
// nothing is needed there.
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { storage } from './storage';

export const MARKER = '.sandpiper-installation';

/** Answers true when this launch is the first of a new installation (iPhone); then the Keychain items are gone. */
export async function forgetEarlierInstallation(platform: string = Platform.OS): Promise<boolean> {
  if (platform !== 'ios') return false;
  const marker = new File(Paths.document, MARKER);
  if (marker.exists) return false;
  await storage.forgetEverything();
  marker.create({ intermediates: true, overwrite: true });
  marker.write('This file tells a launch of the app from a new installation. Deleting it signs the app out.\n');
  return true;
}
