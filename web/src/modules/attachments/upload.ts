// Sends one file as the raw request body, reporting progress. (The JSON api client cannot
// report upload progress, so this uses XMLHttpRequest directly with the same headers.)
import { ApiError, qs } from '../../core';
import { extensionOf, formatBytes, formatLimit, type Attachment, type FileConfig } from './shared';

export interface UploadParams {
  record_type: string;
  record_id: string;
  kind: 'file' | 'evidence';
  collected_on?: string;
  expires_on?: string;
  description?: string;
}

/** Checks the browser can make before sending anything. The server checks again, and more. */
export function refusalFor(file: File, config: FileConfig | undefined): string | null {
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (!config) return null;
  const ext = extensionOf(file.name);
  if (!ext || !config.allowedExtensions.includes(ext)) {
    return `${ext ? `Files of type .${ext}` : 'Files without an extension'} cannot be attached. Allowed types: ${config.allowedExtensions.join(', ')}.`;
  }
  if (file.size > config.maxBytes) {
    return `"${file.name}" is ${formatBytes(file.size)}. The limit is ${formatLimit(config.maxBytes)} for each file.`;
  }
  return null;
}

export function uploadFile(file: File, params: UploadParams, onProgress: (fraction: number) => void): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/attachments/upload${qs({ ...params, name: file.name })}`);
    xhr.setRequestHeader('X-GRC-CSRF', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new ApiError(0, 'network', 'The upload was interrupted. Check that the server is running and try again.'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'The upload was cancelled.'));
    xhr.onload = () => {
      let body: { error?: { code?: string; message?: string; fields?: Record<string, string> } } & Partial<Attachment> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as Attachment);
      const fields = body.error?.fields ?? {};
      const detail = Object.values(fields).join(' ');
      reject(new ApiError(
        xhr.status, body.error?.code ?? `http_${xhr.status}`,
        detail || body.error?.message || `The upload failed (${xhr.status}).`, fields,
      ));
    };
    xhr.send(file);
  });
}
