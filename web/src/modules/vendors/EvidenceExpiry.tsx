// One expiry date for an evidence item and its files (E06-20): a warning on the evidence page
// when the item's date and an evidence file's date disagree, with one click to copy either
// date onto the other. It reappears as soon as a file with another date is attached.
import { useState } from 'react';
import { Button, Icon, api, errorMessage, formatDate, useFetch, useToast } from '../../core';

interface ExpiryReport {
  item: { id: string; expires_on: string | null };
  files: { id: string; file_name: string; expires_on: string | null; differs: boolean }[];
  differs: boolean;
  files_available: boolean;
}

const when = (d: string | null) => (d ? formatDate(d) : 'no expiry date');

export function EvidenceExpiryCheck({ itemId, version, canEdit, onChanged }: { itemId: string; version: number; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const { data, reload } = useFetch<ExpiryReport>(`/api/evidence/${itemId}/expiry?v=${version}`, { keepPrevious: true });
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || !data.differs) return null;

  const differing = data.files.filter((f) => f.differs);
  // One button per distinct file date, naming the file when there is only one with that date.
  const dates = [...new Map(differing.map((f) => [f.expires_on ?? '', f])).values()];

  async function align(body: { use: 'file'; attachment_id: string } | { use: 'item' }, label: string) {
    setBusy(label);
    try {
      await api.post(`/api/evidence/${itemId}/expiry/align`, body);
      toast.success(body.use === 'item' ? 'The files now carry the item\'s expiry date.' : 'The item now carries the file\'s expiry date.');
      reload();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="notice notice-warn-soft vnd-expiry-check" role="note">
      <Icon name="calendar" />
      <div className="vnd-expiry-body">
        <p className="vnd-expiry-title"><strong>The expiry dates do not agree.</strong> Only the item’s date drives the reminders.</p>
        <ul className="vnd-expiry-list">
          <li>This evidence item: <strong>{when(data.item.expires_on)}</strong></li>
          {differing.map((f) => <li key={f.id}>File {f.file_name}: <strong>{when(f.expires_on)}</strong></li>)}
        </ul>
        {canEdit && (
          <div className="row vnd-expiry-actions">
            {dates.filter((f) => f.expires_on).map((f) => (
              <Button key={f.id} size="sm" variant="primary" loading={busy === f.id} disabled={busy !== null}
                onClick={() => void align({ use: 'file', attachment_id: f.id }, f.id)}>
                Use {formatDate(f.expires_on!)} for the item
              </Button>
            ))}
            {data.item.expires_on && (
              <Button size="sm" loading={busy === 'item'} disabled={busy !== null} onClick={() => void align({ use: 'item' }, 'item')}>
                Set the {differing.length === 1 ? 'file' : 'files'} to {formatDate(data.item.expires_on)}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
