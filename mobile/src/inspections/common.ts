// Small helpers of field work on the phone (wave 15): today's date in the organization's time zone,
// photos kept with a draft, and the attachment limits available offline.
import * as ImagePicker from 'expo-image-picker';
import type { MobilePackage } from '../../../shared/mobile-api.ts';
import { attachmentLimits, fitPhoto, photoName, type AttachmentLimits } from '../camera/photos';
import { discardPicture } from '../camera/still';
import { drafts, orOffline } from '../offline';

/** The date (YYYY-MM-DD) in a time zone (the organization's, from the package), or the phone's own. */
export function todayIn(timeZone: string | null | undefined, now = new Date()): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    } catch { /* unknown zone: the phone's date */ }
  }
  const p = (x: number) => String(x).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Limits when neither the server nor the package says: JPEG photos up to 10 MB. */
export const FALLBACK_LIMITS: AttachmentLimits = { maxBytes: 10 * 1024 * 1024, allowedExtensions: ['jpg', 'jpeg', 'png'] };

export const limitsOffline = (): Promise<AttachmentLimits> =>
  orOffline(() => attachmentLimits(), (p: MobilePackage) => p.attachments).catch(() => FALLBACK_LIMITS);

/**
 * Takes a photo with the camera (or chooses one), makes it fit the limits and keeps it in the draft's
 * protected folder. Answers the kept file, or null when the person canceled.
 */
export async function takeDraftPhoto(folder: string, n: number, from: 'camera' | 'library' = 'camera'): Promise<{ uri: string; name: string } | null> {
  const opts = { mediaTypes: ['images'] as ImagePicker.MediaType[], quality: 1, exif: false };
  const res = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  const shot = res.assets[0];
  try {
    const fitted = await fitPhoto(shot.uri, { width: shot.width, height: shot.height }, await limitsOffline());
    try {
      const name = photoName(new Date(), n);
      return { uri: await drafts().keepFile(folder, fitted.uri, name), name };
    } finally {
      discardPicture(fitted.uri);
    }
  } finally {
    // The picker's copy in the app's cache (the person's own picture is never touched).
    discardPicture(shot.uri);
  }
}
