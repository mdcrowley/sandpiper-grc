// When the app asks for Face ID, fingerprint or the device credential (spec §5.2 step 4). Pure.
import type { Prefs, StoredProfile } from './storage';

export interface LockInput {
  prefs: Prefs;
  profile: Pick<StoredProfile, 'unlock'> | null;
  /** When the app went to the background (epoch ms), or null. */
  backgroundAt: number | null;
  now: number;
  /** The app was just launched (always asks when the unlock is on). */
  coldStart: boolean;
}

/** The unlock is on when the person chose it or the administrator requires it (Mobile app settings). */
export function unlockOn(prefs: Prefs, profile: Pick<StoredProfile, 'unlock'> | null): boolean {
  return prefs.unlock || !!profile?.unlock.required;
}

export function shouldLock({ prefs, profile, backgroundAt, now, coldStart }: LockInput): boolean {
  if (!unlockOn(prefs, profile)) return false;
  if (coldStart) return true;
  if (backgroundAt === null) return false;
  const afterMinutes = Math.max(0, profile?.unlock.afterMinutes ?? 5);
  return now - backgroundAt >= afterMinutes * 60_000;
}
