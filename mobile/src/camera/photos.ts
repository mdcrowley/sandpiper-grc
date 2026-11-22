// Photos for reports and records (E38-05 "Add photo", E38-06): taken or chosen on the phone, made to
// fit the server's attachment limits on the device (resized and compressed as JPEG, which also drops
// the picture's location metadata), then uploaded to the record with PUT /api/attachments/upload.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { apiFetch, apiUpload } from '../api/client';

/** What the server accepts (GET /api/attachments/config). */
export interface AttachmentLimits { maxBytes: number; allowedExtensions: string[] }

let cachedLimits: { at: number; limits: AttachmentLimits } | null = null;

/** The server's attachment limits, cached for ten minutes. */
export async function attachmentLimits(): Promise<AttachmentLimits> {
  if (cachedLimits && Date.now() - cachedLimits.at < 600_000) return cachedLimits.limits;
  const c = await apiFetch<{ maxBytes: number; allowedExtensions: string[] }>('/api/attachments/config');
  cachedLimits = { at: Date.now(), limits: { maxBytes: c.maxBytes, allowedExtensions: c.allowedExtensions } };
  return cachedLimits.limits;
}

/** Long edge and JPEG quality, tried in order until the file fits. */
export const RESIZE_STEPS = [
  { edge: 2048, quality: 0.8 },
  { edge: 1600, quality: 0.7 },
  { edge: 1280, quality: 0.6 },
  { edge: 1024, quality: 0.5 },
] as const;

export class PhotoError extends Error {
  constructor(public code: 'too_large' | 'type_not_allowed', message: string) { super(message); this.name = 'PhotoError'; }
}

/** Device operations, replaceable in tests. */
export interface PhotoDevice {
  /** Writes a JPEG of `uri` whose long edge is at most `edge`; returns its uri. */
  resize(uri: string, size: { width: number; height: number }, edge: number, quality: number): Promise<string>;
  bytes(uri: string): number;
  remove(uri: string): void;
}

export const device: PhotoDevice = {
  async resize(uri, known, edge, quality) {
    // The picture's real size when the caller does not know it.
    let size = known;
    if (!size.width || !size.height) {
      const probe = await ImageManipulator.manipulate(uri).renderAsync();
      size = { width: probe.width, height: probe.height };
      probe.release();
    }
    const ctx = ImageManipulator.manipulate(uri);
    if (Math.max(size.width, size.height) > edge) ctx.resize(size.width >= size.height ? { width: edge } : { height: edge });
    const ref = await ctx.renderAsync();
    const saved = await ref.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    return saved.uri;
  },
  bytes(uri) { return new File(uri).size ?? 0; },
  remove(uri) { try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* gone */ } },
};

/**
 * A JPEG of the photo that fits `maxBytes` (the server's limit), trying smaller sizes and stronger
 * compression in turn. Intermediate files are deleted; the original is left alone.
 */
export async function fitPhoto(uri: string, size: { width: number; height: number }, limits: AttachmentLimits, dev: PhotoDevice = device): Promise<{ uri: string; bytes: number }> {
  if (!limits.allowedExtensions.some((e) => e === 'jpg' || e === 'jpeg')) {
    throw new PhotoError('type_not_allowed', 'Your organization does not accept photos (JPEG files) as attachments.');
  }
  for (const step of RESIZE_STEPS) {
    const out = await dev.resize(uri, size, step.edge, step.quality);
    const bytes = dev.bytes(out);
    if (bytes <= limits.maxBytes) return { uri: out, bytes };
    dev.remove(out);
  }
  throw new PhotoError('too_large', 'This photo is larger than your organization allows, even made smaller.');
}

/** A file name for an uploaded photo: photo-20261122-142501-1.jpg. */
export function photoName(at: Date, n: number): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `photo-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}-${n}.jpg`;
}

/** Uploads a (fitted) photo to a record. */
export async function uploadPhoto(recordType: string, recordId: string, uri: string, name: string, description = '', signal?: AbortSignal): Promise<{ id: string }> {
  const q = new URLSearchParams({ record_type: recordType, record_id: recordId, name });
  if (description) q.set('description', description);
  return apiUpload<{ id: string }>(`/api/attachments/upload?${q.toString()}`, { fileUri: uri, signal });
}
