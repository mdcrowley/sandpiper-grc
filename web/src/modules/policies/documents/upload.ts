// Sends a file through the attachments module's chunked upload (start, parts of part_size bytes,
// finish), reporting progress. The finished upload's id is then given to a route that uses it: a new
// version, the Word conversion preview, or a document import. Nothing is attached until then.
import { api, ApiError } from '../../../core';

export interface Upload {
  id: string; file_name: string; extension: string; size: number; status: 'receiving' | 'ready' | 'used' | 'failed';
  part_size: number; part_count: number; parts_received: number; scan_status?: string | null; scan_warning?: string | null;
  attachment_id?: string | null; detail?: string | null;
}

/** SHA-256 of a blob as hexadecimal, or undefined where the browser does not offer it (not a secure page). */
async function sha256(blob: Blob): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function putPart(url: string, part: Blob): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('X-GRC-CSRF', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.onerror = () => reject(new ApiError(0, 'network', 'The upload was interrupted. Check that the server is running and try again.'));
    xhr.onload = () => {
      let body: { error?: { code?: string; message?: string; fields?: Record<string, string> } } & Partial<Upload> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as Upload);
      reject(new ApiError(xhr.status, body.error?.code ?? `http_${xhr.status}`, body.error?.message ?? `The upload failed (${xhr.status}).`, body.error?.fields ?? {}));
    };
    xhr.send(part);
  });
}

/** Uploads the whole file and returns the finished upload (status `ready`). `onProgress` gets 0 to 1. */
export async function uploadInParts(file: File, onProgress: (fraction: number) => void = () => undefined): Promise<Upload> {
  const whole = file.size <= 64 * 1024 * 1024 ? await sha256(file) : undefined;
  const started = await api.post<Upload>('/api/attachments/uploads', { file_name: file.name, size: file.size, sha256: whole });
  const size = started.part_size;
  for (let n = 1; n <= started.part_count; n++) {
    const part = file.slice((n - 1) * size, Math.min(n * size, file.size));
    const digest = await sha256(part);
    await putPart(`/api/attachments/uploads/${started.id}/parts/${n}${digest ? `?sha256=${digest}` : ''}`, part);
    onProgress(n / started.part_count);
  }
  return api.post<Upload>(`/api/attachments/uploads/${started.id}/finish`, {});
}

/** The extension of a file name, lower case, without the dot. */
export const extensionOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
