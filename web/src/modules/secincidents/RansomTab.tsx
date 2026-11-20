import { useEffect, useState } from 'react';
import { ApiError, Button, Card, DefinitionList, errorMessage, Icon, LookupChip, LookupSelect, TextField, useResource, useToast } from '../../core';
import type { RecordContext } from '../../core';

/**
 * Ransom payment decision. "Approved" is refused by the server without the approval reference, while the
 * "recorded approval of a ransom payment" option is on (Administration > Features); its name can be changed there.
 */
export function RansomTab({ rec }: { rec: RecordContext }) {
  const { row, save, canEdit } = rec;
  const toast = useToast();
  // The approval field is in the metadata only while the option is on, under the name the installation gave it.
  const approval = useResource('security_incident')?.fields.board_resolution_ref;
  const name = approval?.label ?? '';
  const lower = /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
  const [status, setStatus] = useState<string>(row.ransom_payment_status ?? 'not_applicable');
  const [resolution, setResolution] = useState<string>(row.board_resolution_ref ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(row.ransom_payment_status ?? 'not_applicable');
    setResolution(row.board_resolution_ref ?? '');
  }, [row.ransom_payment_status, row.board_resolution_ref]);

  const dirty = status !== (row.ransom_payment_status ?? '') || (approval !== undefined && resolution !== (row.board_resolution_ref ?? ''));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Same rule as the server.
    if (approval && status === 'approved' && !resolution.trim()) {
      setErrors({ board_resolution_ref: `Enter the ${lower} before marking the ransom payment approved.` });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await save(approval ? { ransom_payment_status: status, board_resolution_ref: resolution } : { ransom_payment_status: status });
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
          <strong>{approval ? 'A ransom payment needs a recorded approval.' : 'Record every ransom decision.'}</strong>
          <p>
            Your organization's policy or the law may require formal approval before a ransom is paid.
            {approval ? ` This record cannot be set to "Approved" until the ${lower} is entered.` : ''} Every change here is written to the history and to the incident log.
          </p>
        </div>
      </div>
      <Card title="Ransom payment decision">
        {canEdit ? (
          <form className="form" onSubmit={submit} noValidate>
            <div className="form-grid">
              <LookupSelect label="Status" list="ransom_payment_status" value={status} onChange={setStatus} required error={errors.ransom_payment_status} />
              {approval && (
                <TextField label={approval.label} value={resolution} onChange={setResolution}
                  required={status === 'approved'} error={errors.board_resolution_ref}
                  hint="For example the resolution or decision number and its date, as recorded" />
              )}
            </div>
            <div className="form-actions">
              <Button variant="primary" type="submit" loading={busy} disabled={!dirty}>Save decision</Button>
            </div>
          </form>
        ) : (
          <DefinitionList items={[
            { label: 'Status', value: <LookupChip list="ransom_payment_status" value={row.ransom_payment_status} /> },
            ...(approval ? [{ label: approval.label, value: row.board_resolution_ref || '—' }] : []),
          ]} />
        )}
      </Card>
    </div>
  );
}
