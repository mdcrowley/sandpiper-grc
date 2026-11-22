// The calls the work, search, record and approval screens make. Everything goes through
// ../api/client.ts (apiFetch). Owner: APP-WORK.
import { ApiError, CLIENT_ERRORS, apiFetch, type ApiFetchInit } from '../api/client';
import type { MobileHome } from '../../../shared/mobile-api.ts';
import type {
  AckDetail, AckItem, ApprovalItem, AttachmentRow, CommentRow, DecisionResult, HistoryEvent, Meta, RecordRow, ResourceMeta, SearchHit,
} from './types';


const META_TTL_MS = 5 * 60_000;
let metaCache: { at: number; promise: Promise<Meta> } | null = null;

/** Record types the person may view, with their fields and lists (cached for a few minutes). */
export function loadMeta(force = false): Promise<Meta> {
  if (!force && metaCache && Date.now() - metaCache.at < META_TTL_MS) return metaCache.promise;
  const promise = apiFetch<Meta>('/api/meta');
  metaCache = { at: Date.now(), promise };
  promise.catch(() => { if (metaCache?.promise === promise) metaCache = null; });
  return promise;
}

/** Forget the cached meta (tests; signing out). */
export function resetMeta(): void { metaCache = null; }

export function fetchHome(): Promise<MobileHome> {
  return apiFetch<MobileHome>('/api/mobile/home');
}

export function search(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  return apiFetch<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`, { signal });
}

export interface LoadedRecord { row: RecordRow; etag: string | null }

export async function fetchRecord(meta: ResourceMeta, id: string): Promise<LoadedRecord> {
  let etag: string | null = null;
  const init: ApiFetchInit = { onResponse: (info) => { etag = info.etag; } };
  const row = await apiFetch<RecordRow>(`${meta.path}/${encodeURIComponent(id)}`, init);
  return { row, etag };
}

/**
 * Saves changed fields. With an ETag the server refuses a stale edit (409 `version_conflict`).
 * Without one (a client that cannot read headers yet) the record is read again first and a
 * changed `updated_at` counts as the same conflict.
 */
export async function saveRecord(meta: ResourceMeta, seen: LoadedRecord, patch: Record<string, unknown>): Promise<LoadedRecord> {
  if (!seen.etag && seen.row.updated_at) {
    const now = await fetchRecord(meta, seen.row.id);
    if (now.row.updated_at !== seen.row.updated_at) {
      throw new ApiError(409, 'version_conflict', `This ${meta.label.toLowerCase()} has changed since you opened it.`);
    }
  }
  let etag: string | null = null;
  const init: ApiFetchInit = {
    method: 'PATCH', body: patch, ifMatch: seen.etag ?? undefined, onResponse: (info) => { etag = info.etag; },
  };
  const row = await apiFetch<RecordRow>(`${meta.path}/${encodeURIComponent(seen.row.id)}`, init);
  return { row, etag };
}

const recordQuery = (type: string, id: string) => `record_type=${encodeURIComponent(type)}&record_id=${encodeURIComponent(id)}`;

export function fetchHistory(type: string, id: string): Promise<HistoryEvent[]> {
  return apiFetch<HistoryEvent[]>(`/api/history?${recordQuery(type, id)}`);
}

export function fetchComments(type: string, id: string): Promise<CommentRow[]> {
  return apiFetch<CommentRow[]>(`/api/comments?${recordQuery(type, id)}`);
}

export function addComment(type: string, id: string, body: string): Promise<CommentRow> {
  return apiFetch<CommentRow>('/api/comments', { method: 'POST', body: { record_type: type, record_id: id, body } });
}

export async function fetchAttachments(type: string, id: string): Promise<AttachmentRow[]> {
  const answer = await apiFetch<{ rows: AttachmentRow[] }>(`/api/attachments?${recordQuery(type, id)}`);
  return answer.rows ?? [];
}

export interface Option { id: string; label: string; ref?: string | null }

export function userOptions(q: string): Promise<Option[]> {
  return apiFetch<Option[]>(`/api/users/options?q=${encodeURIComponent(q)}`);
}

export function recordOptions(type: string, q: string): Promise<Option[]> {
  return apiFetch<Option[]>(`/api/records/lookup?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`);
}

// ---------- approvals and acknowledgments ----------

export async function fetchApprovals(): Promise<ApprovalItem[]> {
  const answer = await apiFetch<{ rows: ApprovalItem[] }>('/api/workflows/approvals');
  return answer.rows ?? [];
}

export function decide(stepId: string, decision: 'approved' | 'rejected', comment: string): Promise<DecisionResult> {
  return apiFetch<DecisionResult>(`/api/workflows/steps/${encodeURIComponent(stepId)}/decision`, {
    method: 'POST', body: { decision, comment: comment.trim() || undefined },
  });
}

export async function fetchAcknowledgments(): Promise<AckItem[]> {
  const answer = await apiFetch<{ awaiting: AckItem[] }>('/api/policies/acknowledgments/mine');
  return answer.awaiting ?? [];
}

export function fetchAcknowledgment(id: string): Promise<AckDetail> {
  return apiFetch<AckDetail>(`/api/policies/acknowledgments/${encodeURIComponent(id)}`);
}

export function acknowledge(id: string): Promise<AckItem> {
  return apiFetch<AckItem>(`/api/policies/acknowledgments/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
}

/** A readable sentence for any failure, for the screens' error boxes. */
export function errorText(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (err instanceof ApiError) {
    if (err.code === CLIENT_ERRORS.offline) return 'Could not reach the server. Check the connection and try again.';
    if (err.status === 404) return 'Not found, or you may not see it.';
    return err.message || fallback;
  }
  return fallback;
}
