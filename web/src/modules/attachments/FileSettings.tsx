// Administration > File settings: upload limits, malware scanning, where files are kept,
// reading scans (OCR languages, E46-56), removed files and storage usage.
import { useSearchParams } from 'react-router-dom';
import { ErrorState, Loading, PageHeader, Stat, Tabs, useFetch } from '../../core';
import type { FilesOverview } from './adminTypes';
import { STORE_LABELS } from './adminTypes';
import { OcrSettings } from './OcrSettings';
import { RemovedFiles } from './RemovedFiles';
import { ScannerSettings } from './ScannerSettings';
import { StorageSettings } from './StorageSettings';
import { UploadLimits } from './UploadLimits';
import { formatBytes } from './shared';
import './attachments.css';

const TABS = ['uploads', 'scanning', 'ocr', 'storage', 'removed'];

export function FileSettings() {
  const { data, error, reload } = useFetch<FilesOverview>('/api/attachments/admin/overview');
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab') ?? '') ? params.get('tab')! : 'uploads';
  const u = data?.usage;
  const stores = u?.byDriver.map((d) => `${d.files} file${d.files === 1 ? '' : 's'} (${formatBytes(d.bytes)}) on ${(STORE_LABELS[d.driver] ?? d.driver).replace(/^Local/, 'the local').replace(/^Object/, 'the object')}`).join('; ');

  return (
    <div className="stack att-admin">
      <PageHeader
        title="File settings"
        subtitle="Limits, malware scanning, reading scans and storage for files attached to records."
        breadcrumbs={[{ label: 'Administration' }, { label: 'File settings' }]}
      />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data || !u ? <Loading lines={6} label="Loading file settings" /> : (
        <>
          <div className="grid-stats">
            <Stat label="Files in use" value={u.active.files} hint={formatBytes(u.active.bytes)} icon="file-text" />
            <Stat label="Removed, waiting to be purged" value={u.removed.files} hint={formatBytes(u.removed.bytes)} icon="trash" />
            <Stat label="Not scanned for malware" value={u.notScanned} color={u.notScanned ? 'amber' : undefined} hint={data.activeScanner === 'none' ? 'Scanning is off' : `Scanner: ${data.activeScanner}`} icon="shield" />
            <Stat label="New files go to" value={data.storage.driver === 's3' ? 'Object store' : 'Local disk'} hint={stores || 'Nothing stored yet'} icon="database" />
          </div>
          <Tabs
            label="File settings"
            active={tab}
            onChange={(key) => setParams((p) => { const next = new URLSearchParams(p); next.set('tab', key); return next; }, { replace: true })}
            tabs={[
              { key: 'uploads', label: 'Uploads', content: <UploadLimits /> },
              { key: 'scanning', label: 'Malware scanning', content: <ScannerSettings overview={data} onSaved={reload} /> },
              { key: 'ocr', label: 'Reading scans', content: <OcrSettings /> },
              { key: 'storage', label: 'Storage', content: <StorageSettings overview={data} onSaved={reload} /> },
              { key: 'removed', label: 'Removed files', count: u.removed.files, content: <RemovedFiles purgeDays={data.purgeDays} onChanged={reload} /> },
            ]}
          />
        </>
      )}
    </div>
  );
}
