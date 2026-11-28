// Asking vendors for certificates of insurance by email (E46-65): the Requests tab, one request's page
// (Send, Send a reminder, Cancel, and the certificates that came back), and the "Ask for certificates"
// dialog used on a contract's Insurance tab and on the Certificates tab.
import { useState } from 'react';
import {
  api, Button, ConfirmDialog, DateField, errorMessage, formatDateTime, Modal, MultiSelect, Notice, PageHeader, RecordPage, ResourceList, TextArea,
  TextField, useAuth, useFetch, useLookup, useToast, useUnsavedChanges,
} from '../../core';
import type { ColumnDef, RecordContext, Row } from '../../core';

export interface RequestSettings { enabled: boolean; days: number; max_days: number; email_available: boolean; files_available: boolean; can_administer: boolean }

export function useRequestSettings() {
  return useFetch<RequestSettings>('/api/insurance/certificate-requests/settings');
}

/** Why a request cannot be emailed now, in words for the person asking; null when it can. */
export function cannotSend(s: RequestSettings | undefined | null, sent = false): string | null {
  if (!s) return null;
  if (!s.enabled) return s.can_administer
    ? 'Certificate requests to vendors are switched off. Switch them on under Insurance > Settings to email the request.'
    : 'Certificate requests to vendors are switched off. An administrator can switch them on under Insurance > Settings; the request is kept as not sent until then.';
  if (!s.email_available) return sent ? 'Email is not set up, so no reminder can be emailed.' : 'Email is not set up, so the request cannot be emailed yet. It is kept as not sent.';
  return null;
}

const COLUMNS: ColumnDef[] = [
  'ref', 'title', { field: 'status', priority: 1 }, { field: 'email', priority: 3 }, { field: 'needed_by', priority: 2 }, { field: 'sent_at', priority: 2 },
  { field: 'certificates', priority: 2 }, { field: 'owner_id', priority: 3 }, { field: 'contract_id', hidden: true }, { field: 'vendor_id', hidden: true },
];

export function RequestList() {
  const { data } = useRequestSettings();
  const why = cannotSend(data);
  return (
    <div className="stack">
      <PageHeader title="Certificate requests" subtitle="Requests to vendors for their certificates of insurance, each emailed with a personal upload link. What the vendor sends lands on the Certificates tab for review." />
      {why && <Notice tone="info">{why}</Notice>}
      <ResourceList type="insurance_certificate_request" urlState columns={COLUMNS} filters={['status', 'vendor_id', 'contract_id', 'owner_id', 'needed_by']}
        createFields={['vendor_id', 'contract_id', 'lines', 'email', 'recipient_name', 'needed_by', 'message', 'owner_id', 'title', 'notes']} />
    </div>
  );
}

function RequestActions({ row, reload }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const { data: s } = useRequestSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  if (!can('insurance.edit')) return null;
  const open = row.status === 'draft' || row.status === 'sent';
  const linkOpen = row.status === 'sent' && row.link_expires_at && new Date(String(row.link_expires_at)).getTime() > Date.now();
  const sendable = !cannotSend(s) && open && Boolean(row.email);
  const act = async (what: 'send' | 'remind') => {
    setBusy(what);
    try {
      await api.post(`/api/insurance/certificate-requests/${row.id}/${what}`, {});
      toast.success(what === 'send' ? `Request emailed to ${row.email}.` : `Reminder emailed to ${row.email}.`);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  const cancel = async () => {
    setBusy('cancel');
    try {
      await api.patch(`/api/insurance/certificate-requests/${row.id}`, { status: 'canceled' });
      toast.success('Request canceled. Its link no longer works.');
      setCanceling(false); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  return (
    <>
      {open && <Button variant="primary" icon="message" disabled={!sendable} loading={busy === 'send'} onClick={() => void act('send')}>{row.sent_at ? 'Send again' : 'Send'}</Button>}
      {linkOpen && <Button icon="clock" disabled={!sendable} loading={busy === 'remind'} onClick={() => void act('remind')}>Send a reminder</Button>}
      {open && <Button variant="ghost" onClick={() => setCanceling(true)}>Cancel request</Button>}
      <ConfirmDialog open={canceling} title="Cancel this request?" confirmLabel="Cancel request" danger busy={busy === 'cancel'}
        message="The vendor's link stops working at once. Certificates already sent stay on the Certificates tab." onConfirm={() => void cancel()} onCancel={() => setCanceling(false)} />
    </>
  );
}

function RequestBanner({ row }: RecordContext) {
  const { data: s } = useRequestSettings();
  const why = row.status === 'draft' || row.status === 'sent' ? cannotSend(s, row.status === 'sent') : null;
  if (why) return <Notice tone="info">{why}</Notice>;
  if (row.status === 'draft' && !row.email) return <Notice tone="info">Give the address the request goes to, then send it.</Notice>;
  if (row.status === 'sent' && row.link_expires_at && new Date(String(row.link_expires_at)).getTime() <= Date.now()) {
    return <Notice tone="warning" title="The vendor's link has expired">Send the request again to give the vendor a new link.</Notice>;
  }
  if (row.status === 'sent') return <Notice tone="neutral">{`Emailed ${formatDateTime(String(row.sent_at))}. The link works until ${formatDateTime(String(row.link_expires_at))}${row.opened_at ? `; the vendor opened it ${formatDateTime(String(row.opened_at))}` : '; not opened yet'}.`}</Notice>;
  return null;
}

function ReceivedCertificates({ row }: RecordContext) {
  return (
    <ResourceList type="insurance_certificate" baseFilter={{ request_id: String(row.id) }} columns={['ref', 'title', 'line', 'status', 'check_result', 'expires_on']}
      filters={['status']} bulkFields={[]} />
  );
}

export function RequestDetail() {
  return (
    <RecordPage
      type="insurance_certificate_request"
      actions={(rec) => <RequestActions {...rec} />}
      banner={(rec) => <RequestBanner {...rec} />}
      summaryFields={['title', 'vendor_id', 'contract_id', 'lines', 'email', 'recipient_name', 'needed_by', 'message', 'status', 'owner_id', 'sent_at', 'link_expires_at', 'opened_at', 'reminders', 'reminded_at', 'submitted_at', 'responder_name', 'certificates', 'notes']}
      tabs={[{ key: 'certificates', label: 'Certificates received', content: (rec) => <ReceivedCertificates {...rec} /> }]}
    />
  );
}

/** Ask a vendor for certificates: a request made and, when it can be, emailed at once. */
export function AskDialog({ open, onClose, contractId, vendorId, lines: wanted, onDone }: {
  open: boolean; onClose: () => void; contractId?: string | null; vendorId?: string | null; lines?: string[]; onDone?: (request: Row) => void;
}) {
  const toast = useToast();
  const { data: s } = useRequestSettings();
  const lineOptions = useLookup('insurance_line').map((v) => ({ value: v.value, label: v.label }));
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [lines, setLines] = useState<string[]>(wanted ?? []);
  const [neededBy, setNeededBy] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(email || name || neededBy || message);
  const unsaved = useUnsavedChanges(open && dirty);
  const why = cannotSend(s);
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      const made = await api.post<Row>('/api/insurance/certificate-requests', {
        contract_id: contractId ?? null, vendor_id: vendorId ?? null, email, recipient_name: name || null, lines, needed_by: neededBy || null, message: message || null,
      });
      let sent = false;
      if (!why) {
        try { await api.post(`/api/insurance/certificate-requests/${made.id}/send`, {}); sent = true; } catch (err) { toast.error(`The request was saved as ${made.ref} but not sent: ${errorMessage(err)}`); }
      }
      unsaved.release();
      if (sent) toast.success(`Request ${made.ref} emailed to ${made.email}.`);
      else if (why) toast.success(`Request ${made.ref} saved, not sent yet.`);
      setEmail(''); setName(''); setNeededBy(''); setMessage('');
      onDone?.(made);
      onClose();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields && Object.keys(fields).length) setErrors(fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Ask for certificates of insurance" onClose={onClose} dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>{why ? 'Save request' : 'Send request'}</Button></>}>
      <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {why && <Notice tone="info">{why}</Notice>}
        <TextField label="Send to (email)" required type="email" value={email} onChange={setEmail} error={errors.email} hint="The vendor's insurance contact or broker. The email carries a personal upload link." />
        <TextField label="Recipient" value={name} onChange={setName} error={errors.recipient_name} />
        <MultiSelect label="Lines of coverage asked for" options={lineOptions} value={lines} onChange={setLines} error={errors.lines} />
        <DateField label="Needed by" value={neededBy} onChange={setNeededBy} error={errors.needed_by} />
        <TextArea label="Message" value={message} onChange={setMessage} error={errors.message} hint="A few words of your own for the email (optional)." rows={3} />
        {errors.vendor_id && <Notice tone="error">{errors.vendor_id}</Notice>}
      </form>
    </Modal>
  );
}
