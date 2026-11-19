// Export menu for record lists (CSV, Excel, PDF) and the record fact sheet button. The server
// applies the same search, filters, sort, columns, permissions and restricted-record rule to every
// format, and writes an audit event for each export.
import { useState } from 'react';
import { Button, Menu, Text, Tooltip } from '@mantine/core';
import { IconChevronDown, IconDownload, IconFileSpreadsheet, IconFileText, IconFileTypeCsv } from '@tabler/icons-react';
import { api, errorMessage, listQuery, type ListQuery } from './api';
import { useAuth } from './auth';
import type { ResourceMeta } from './meta';
import { useToast } from './overlay';
import { Button as UiButton } from './ui';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

const FORMATS: { format: ExportFormat; label: string; hint: string; Icon: typeof IconFileText }[] = [
  { format: 'xlsx', label: 'Excel (XLSX)', hint: 'Typed dates, numbers and amounts', Icon: IconFileSpreadsheet },
  { format: 'csv', label: 'CSV', hint: 'Plain text, for any program', Icon: IconFileTypeCsv },
  { format: 'pdf', label: 'PDF', hint: 'A printable table', Icon: IconFileText },
];

/** Saves a server download under a file name. */
export async function saveDownload(url: string, name: string): Promise<void> {
  const blob = await api.blob(url);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'export';

export interface ExportMenuProps {
  resource: ResourceMeta;
  /** The list's search, filters and sort. */
  query: ListQuery;
  /** Fields of the columns on screen, in order; the export takes these columns. */
  columns: string[];
  /** True when a search or filter is applied (changes the wording only). */
  filtered: boolean;
}

/** "Export" with a choice of CSV, Excel and PDF: every row that matches, not just the page on screen. */
export function ExportMenu({ resource, query, columns, filtered }: ExportMenuProps) {
  const toast = useToast();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const plural = resource.plural.toLowerCase();
  const run = async (format: ExportFormat) => {
    setBusy(format);
    try {
      const url = `${resource.path}${listQuery({ ...query }, { format, columns: columns.join(',') || undefined })}`;
      await saveDownload(url, `${slug(resource.plural)}.${format}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Menu position="bottom-end" shadow="md" width={250}>
      <Menu.Target>
        <Tooltip label={`Export ${filtered ? 'the filtered' : 'all'} ${plural}`}>
          <Button
            variant="default"
            className="rc-icon-label"
            loading={busy !== null}
            leftSection={<IconDownload size={16} aria-hidden="true" />}
            rightSection={<IconChevronDown size={14} aria-hidden="true" />}
          >
            <span className="rc-btn-label">Export</span>
            <span className="rc-sr-only"> {filtered ? 'the filtered' : 'all'} {plural}</span>
          </Button>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{filtered ? `The filtered ${plural}` : `All ${plural}`}, columns on screen</Menu.Label>
        {FORMATS.map(({ format, label, hint, Icon }) => (
          <Menu.Item key={format} leftSection={<Icon size={18} aria-hidden="true" />} onClick={() => void run(format)}>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
              <span>{label}</span>
              <Text component="span" size="xs" c="dimmed">{hint}</Text>
            </span>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Downloads one record as a PDF fact sheet (its fields, tags and recent history). Shown to people
 * who may export the record type; place it among a record page's header buttons.
 */
export function RecordPdfButton({ resource, id, label }: { resource: ResourceMeta; id: string; label?: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!can(`${resource.module}.export`)) return null;
  const download = async () => {
    setBusy(true);
    try {
      await saveDownload(`/api/records/${encodeURIComponent(resource.type)}/${encodeURIComponent(id)}/pdf`, `${slug(`${resource.label}-${label ?? id}`)}.pdf`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <UiButton icon="download" loading={busy} onClick={() => void download()} title={`Download this ${resource.label.toLowerCase()} as a PDF fact sheet`}>
      PDF
    </UiButton>
  );
}
