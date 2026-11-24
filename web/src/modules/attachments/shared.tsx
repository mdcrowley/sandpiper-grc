// Types and small helpers shared by the attachments panel and pages.
import {
  IconFile, IconFileDescription, IconFileSpreadsheet, IconFileText, IconFileTypePdf, IconFileZip, IconLink, IconMail, IconPhoto,
  IconPresentation,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';
import { api, formatDate, type ColorName } from '../../core';
import { daysBetween } from '../../../../shared/dates.ts';
export { daysBetween }; // one copy for every module (E40-12)

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
  scan_status: 'not_scanned' | 'clean' | 'not_applicable';
  scan_engine: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
  /** Evidence by link (E36-05): an address of a document kept elsewhere instead of a stored copy. */
  is_link?: boolean;
  link_url?: string | null;
  link_title?: string | null;
  /** When someone last confirmed the linked document is still there and current (links only). */
  last_checked_on?: string | null;
  checked_by_name?: string | null;
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
  link: { glyph: IconLink, color: 'blue', label: 'Link to a document kept elsewhere' },
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

/** Color and wording for when a link was last checked: due once `days` have passed since. */
export function linkCheckState(lastCheckedOn: string | null | undefined, today: string, days: number): { color: ColorName; label: string; due: boolean } {
  if (!lastCheckedOn) return { color: 'amber', label: 'Never checked', due: true };
  const since = daysBetween(lastCheckedOn, today);
  if (since >= days) return { color: 'orange', label: `Check due: last checked ${formatDate(lastCheckedOn)}`, due: true };
  return { color: 'green', label: since === 0 ? 'Checked today' : `Checked ${formatDate(lastCheckedOn)}`, due: false };
}

/**
 * Fetches the file and hands it to the browser as a download. Rejects with the server's error.
 * A link (E36-05) opens its address in a new tab instead, with no referrer.
 */
export async function downloadAttachment(att: Pick<Attachment, 'id' | 'file_name'> & Partial<Pick<Attachment, 'is_link' | 'link_url'>>): Promise<void> {
  if (att.is_link) {
    if (att.link_url && /^https?:\/\//i.test(att.link_url)) window.open(att.link_url, '_blank', 'noopener,noreferrer');
    return;
  }
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
