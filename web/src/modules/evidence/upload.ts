// Sends a file through the attachments module's chunked upload (start, parts of part_size bytes,
// finish), reporting progress. The finished upload's id is then given to a route that files it:
// POST /api/evidence-library/upload, or a funder document request's files route. Nothing is
// attached until then, so a person who may not change the evidence record can still provide a file.
import { api, ApiError } from '../../core';

export interface Upload { id: string; file_name: string; size: number; status: string; part_size: number; part_count: number }

async function sha256(blob: Blob): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function putPart(url: string, part: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('X-GRC-CSRF', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onerror = () => reject(new ApiError(0, 'network', 'The upload was interrupted. Check that the server is running and try again.'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let body: { error?: { code?: string; message?: string; fields?: Record<string, string> } } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      reject(new ApiError(xhr.status, body.error?.code ?? `http_${xhr.status}`, body.error?.message ?? `The upload failed (${xhr.status}).`, body.error?.fields ?? {}));
    };
    xhr.send(part);
  });
}

/** Uploads the whole file and answers the finished upload. `onProgress` gets 0 to 1. */
export async function uploadInParts(file: File, onProgress: (fraction: number) => void = () => undefined): Promise<Upload> {
  const whole = file.size <= 64 * 1024 * 1024 ? await sha256(file) : undefined;
  const started = await api.post<Upload>('/api/attachments/uploads', { file_name: file.name, size: file.size, sha256: whole });
  for (let n = 1; n <= started.part_count; n++) {
    const part = file.slice((n - 1) * started.part_size, Math.min(n * started.part_size, file.size));
    const digest = await sha256(part);
    await putPart(`/api/attachments/uploads/${started.id}/parts/${n}${digest ? `?sha256=${digest}` : ''}`, part);
    onProgress(n / started.part_count);
  }
  return api.post<Upload>(`/api/attachments/uploads/${started.id}/finish`, {});
}
