// Types and small helpers shared by the attachments panel and pages.
import {
  IconFile, IconFileDescription, IconFileSpreadsheet, IconFileText, IconFileTypePdf, IconFileZip, IconMail, IconPhoto,
  IconPresentation,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import { api, formatDate, type ColorName } from '../../core';

export interface Attachment {
  id: string;
  record_type: string;
  record_id: string;
  file_name: string;
  extension: string;
  /** pdf, image, text, sheet, slides, document, archive, mail or file. */
  type_group: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  kind: 'file' | 'evidence';
  description: string | null;
  collected_on: string | null;
  expires_on: string | null;
  scan_status: 'not_scanned' | 'clean';
  scan_engine: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  /** Only on the upload response: the scanner could not check the file and it was accepted anyway. */
  scan_warning?: string;
}

export interface FileConfig {
  maxBytes: number;
  allowedExtensions: string[];
  scanner: string;
  whenUnavailable: 'accept' | 'refuse';
  canAdminister: boolean;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Whole megabytes read more naturally in limits: "25 MB". */
export function formatLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb} MB` : formatBytes(bytes);
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

type Glyph = ComponentType<{ size?: number; stroke?: number }>;
const GROUPS: Record<string, { glyph: Glyph; color: ColorName; label: string }> = {
  pdf: { glyph: IconFileTypePdf, color: 'red', label: 'PDF document' },
  image: { glyph: IconPhoto, color: 'purple', label: 'Image' },
  text: { glyph: IconFileText, color: 'gray', label: 'Text file' },
  sheet: { glyph: IconFileSpreadsheet, color: 'green', label: 'Spreadsheet' },
  slides: { glyph: IconPresentation, color: 'orange', label: 'Presentation' },
  document: { glyph: IconFileDescription, color: 'blue', label: 'Document' },
  archive: { glyph: IconFileZip, color: 'amber', label: 'Archive' },
  mail: { glyph: IconMail, color: 'teal', label: 'Email message' },
  file: { glyph: IconFile, color: 'gray', label: 'File' },
};

/** A tinted tile with an icon for the kind of file. The file name beside it carries the meaning. */
export function FileTypeIcon({ group }: { group: string }) {
  const g = GROUPS[group] ?? GROUPS.file;
  const Glyph = g.glyph;
  return (
    <span className="att-icon" style={{ background: `var(--c-${g.color}-bg)`, color: `var(--c-${g.color}-fg)` }} title={g.label} aria-hidden="true">
      <Glyph size={20} stroke={1.75} />
    </span>
  );
}

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Color and wording for an expiry date, relative to the organization's "today". */
export function expiryState(expiresOn: string | null, today: string): { color: ColorName; label: string } | null {
  if (!expiresOn) return null;
  const days = daysBetween(today, expiresOn);
  if (days < 0) return { color: 'red', label: `Expired ${plural(-days, 'day')} ago` };
  if (days === 0) return { color: 'red', label: 'Expires today' };
  if (days <= 30) return { color: 'orange', label: `Expires in ${plural(days, 'day')}` };
  if (days <= 90) return { color: 'amber', label: `Expires in ${plural(days, 'day')}` };
  return { color: 'green', label: `Expires ${formatDate(expiresOn)}` };
}

/** Fetches the file and hands it to the browser as a download. Rejects with the server's error. */
export async function downloadAttachment(att: Pick<Attachment, 'id' | 'file_name'>): Promise<void> {
  const blob = await api.blob(`/api/attachments/${att.id}/download`);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = att.file_name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
