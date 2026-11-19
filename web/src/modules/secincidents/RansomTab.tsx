import { useEffect, useState } from 'react';
import { ApiError, Button, Card, DefinitionList, errorMessage, Icon, LookupChip, LookupSelect, TextField, useToast } from '../../core';
import type { RecordContext } from '../../core';

/** Ransom payment decision. "Approved" is refused by the server without a governing body approval reference. */
export function RansomTab({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  const [status, setStatus] = useState<string>(row.ransom_payment_status ?? 'not_applicable');
  const [resolution, setResolution] = useState<string>(row.board_resolution_ref ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(row.ransom_payment_status ?? 'not_applicable');
    setResolution(row.board_resolution_ref ?? '');
  }, [row.ransom_payment_status, row.board_resolution_ref]);

  const dirty = status !== (row.ransom_payment_status ?? '') || resolution !== (row.board_resolution_ref ?? '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Same rule as the server.
    if (status === 'approved' && !resolution.trim()) {
      setErrors({ board_resolution_ref: 'Enter the governing body approval reference before marking the ransom payment approved.' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await save({ ransom_payment_status: status, board_resolution_ref: resolution });
      toast.success('Ransom payment decision saved and recorded in the log.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="si-callout" role="note">
        <Icon name="lock" size={20} />
        <div>
          <strong>A ransom payment needs a recorded approval.</strong>
          <p>
            Your organisation's policy or the law may require formal approval before a ransom is paid. This record cannot be
            set to "Approved" until the governing body approval reference is entered. Every change here is written to the history and to the incident log.
          </p>
        </div>
      </div>
      <Card title="Ransom payment decision">
        {canEdit ? (
          <form className="form" onSubmit={submit} noValidate>
            <div className="form-grid">
              <LookupSelect label="Status" list="ransom_payment_status" value={status} onChange={setStatus} required error={errors.ransom_payment_status} />
              <TextField label="Governing body approval reference" value={resolution} onChange={setResolution}
                required={status === 'approved'} error={errors.board_resolution_ref}
                hint="For example the resolution or decision number and the meeting date, as recorded in the minutes" />
            </div>
            <div className="form-actions">
              <Button variant="primary" type="submit" loading={busy} disabled={!dirty}>Save decision</Button>
            </div>
          </form>
        ) : (
          <DefinitionList items={[
            { label: 'Status', value: <LookupChip list="ransom_payment_status" value={row.ransom_payment_status} /> },
            { label: 'Governing body approval reference', value: row.board_resolution_ref || '—' },
          ]} />
        )}
      </Card>
    </div>
  );
}
