// How the outbox reaches the server (wave 14, E38-10): POST /api/mobile/sync for a batch,
// PUT /api/mobile/sync/attachment for one photo, through the app's only connection (api/client.ts).
import { File } from 'expo-file-system';
import type { MobilePackage, SyncAnswer, SyncResponse } from '../../../shared/mobile-api.ts';
import { apiFetch, apiUpload } from '../api/client';
import type { OutboxTransport } from './types';

export const serverTransport: OutboxTransport = {
  async sync(items) {
    const res = await apiFetch<SyncResponse>('/api/mobile/sync', { method: 'POST', body: { items } });
    return res.items;
  },
  async upload(item) {
    // A photo no longer on the phone cannot be sent: the person sees it under Needs attention.
    if (!item.file || !new File(item.file).exists) {
      return { clientId: item.id, status: 'rejected', error: { code: 'file_missing', message: 'This photo is no longer on the phone.' } };
    }
    const p = item.payload as { parent?: string; recordType?: string; recordId?: string; name?: string; description?: string };
    // The photo's own id is its idempotency key (clientId): sent again, it is attached once.
    const q = new URLSearchParams({ clientId: item.id, name: String(p.name ?? 'photo.jpg') });
    // A photo of a report goes to the record the report made: the server knows it by the report's id.
    const parent = p.parent ?? item.dependsOn;
    if (parent) q.set('parent', parent);
    else if (p.recordType && p.recordId) { q.set('record_type', p.recordType); q.set('record_id', p.recordId); }
    if (p.description) q.set('description', p.description);
    return apiUpload<SyncAnswer>(`/api/mobile/sync/attachment?${q.toString()}`, { fileUri: item.file, contentType: 'application/octet-stream' });
  },
};

export const fetchPackage = () => apiFetch<MobilePackage>('/api/mobile/package');
