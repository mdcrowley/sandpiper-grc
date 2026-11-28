// A contract's Insurance tab (E46-63), shown on the contract page while the insurance area is on and the
// person may see it: the insurance the contract requires, each requirement's state against the
// certificates on file, those certificates with their check, and the requests to the vendor for
// certificates (E46-65), with Add requirement, Add certificate and Ask for certificates.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, formatCurrency, formatDate, formatDateTime, Loading, LookupChip, Modal, ResourceForm, TableWrap, useAuth, useFetch, useToast,
} from '../../core';
import { AskDialog } from './Requests';
import './insurance.css';

interface Check {
  requirements: { id: string; title: string; line: string; min_per_occurrence: number | null; min_aggregate: number | null; additional_insured: boolean; waiver_of_subrogation: boolean; state: string | null; state_notes: string | null }[];
  certificates: { id: string; ref: string; title: string; line: string; status: string; expires_on: string | null; limit_per_occurrence: number | null; check_result: string | null; check_notes: string | null }[];
  requests: { id: string; ref: string; title: string; status: string; email: string | null; needed_by: string | null; sent_at: string | null; link_expires_at: string | null; submitted_at: string | null; certificates: number }[];
}

const terms = (r: Check['requirements'][number]) => [r.additional_insured ? 'additional insured' : null, r.waiver_of_subrogation ? 'waiver of subrogation' : null].filter(Boolean).join(', ');

export function ContractInsurance({ contractId, vendorId }: { contractId: string; vendorId?: string | null }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<Check>(`/api/insurance/contracts/${contractId}/check`);
  const [adding, setAdding] = useState<'requirement' | 'certificate' | null>(null);
  const [asking, setAsking] = useState(false);
  const create = can('insurance.create');
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={5} label="Loading the contract's insurance" />;
  const met = data.requirements.filter((r) => r.state === 'met').length;
  return (
    <div className="stack">
      <Card
        title="What the contract requires"
        flush
        actions={create ? (
          <div className="ins-actions">
            <Button size="sm" icon="plus" onClick={() => setAdding('requirement')}>Add requirement</Button>
            {can('insurance.edit') && <Button size="sm" icon="message" onClick={() => setAsking(true)}>Ask for certificates</Button>}
          </div>
        ) : undefined}
      >
        {data.requirements.length === 0 ? (
          <EmptyState icon="scale" title="No insurance requirements recorded" message="Add each line of coverage the contract requires, with its minimum limits; certificates on file are then checked against it." />
        ) : (
          <>
            <p className="muted ins-pad ins-small">{met} of {data.requirements.length} met by a current certificate on file.</p>
            <TableWrap label="Insurance the contract requires" fit>
              <table className="table">
                <caption className="sr-only">Insurance the contract requires</caption>
                <thead>
                  <tr>
                    <th scope="col">Line</th><th scope="col">Minimum per occurrence</th><th scope="col" data-priority="3">Minimum aggregate</th>
                    <th scope="col" data-priority="3">Terms</th><th scope="col">Certificates on file</th><th scope="col" data-priority="2">What is missing</th>
                  </tr>
                </thead>
                <tbody>
                  {data.requirements.map((r) => (
                    <tr key={r.id}>
                      <td><Link className="row-title" to={`/insurance/requirements/${r.id}`}><LookupChip list="insurance_line" value={r.line} /></Link></td>
                      <td>{formatCurrency(r.min_per_occurrence)}</td>
                      <td data-priority="3">{formatCurrency(r.min_aggregate)}</td>
                      <td data-priority="3">{terms(r) || <span className="muted">—</span>}</td>
                      <td>{r.state ? <LookupChip list="insurance_requirement_state" value={r.state} /> : <span className="muted">—</span>}</td>
                      <td data-priority="2">{r.state_notes ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </Card>

      <Card title="Certificates of insurance" flush actions={create ? <Button size="sm" icon="plus" onClick={() => setAdding('certificate')}>Add certificate</Button> : undefined}>
        {data.certificates.length === 0 ? (
          <EmptyState icon="file-text" title="No certificates on file" message="Add the vendor's certificates of insurance, or ask the vendor to send them." />
        ) : (
          <TableWrap label="Certificates of insurance for this contract" fit>
            <table className="table">
              <caption className="sr-only">Certificates of insurance for this contract</caption>
              <thead><tr><th scope="col">Certificate</th><th scope="col">Status</th><th scope="col">Against the contract</th><th scope="col" data-priority="2">Expires</th><th scope="col" data-priority="3">Limit per occurrence</th></tr></thead>
              <tbody>
                {data.certificates.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="row-title" to={`/insurance/certificates/${c.id}`}><span className="ref">{c.ref}</span> {c.title}</Link>
                      {c.check_notes && <span className="muted ins-small ins-block">{c.check_notes}</span>}</td>
                    <td><LookupChip list="insurance_certificate_status" value={c.status} /></td>
                    <td>{c.check_result ? <LookupChip list="insurance_certificate_check" value={c.check_result} /> : <span className="muted">—</span>}</td>
                    <td data-priority="2">{c.expires_on ? formatDate(c.expires_on) : <span className="muted">—</span>}</td>
                    <td data-priority="3">{formatCurrency(c.limit_per_occurrence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {data.requests.length > 0 && (
        <Card title="Requests to the vendor" flush>
          <TableWrap label="Requests to the vendor for certificates" fit>
            <table className="table">
              <caption className="sr-only">Requests to the vendor for certificates</caption>
              <thead><tr><th scope="col">Request</th><th scope="col">Status</th><th scope="col" data-priority="2">Sent</th><th scope="col" data-priority="3">Needed by</th><th scope="col">Certificates received</th></tr></thead>
              <tbody>
                {data.requests.map((q) => (
                  <tr key={q.id}>
                    <td><Link className="row-title" to={`/insurance/certificate-requests/${q.id}`}><span className="ref">{q.ref}</span> {q.title}</Link></td>
                    <td><LookupChip list="insurance_request_status" value={q.status} /></td>
                    <td data-priority="2">{q.sent_at ? formatDateTime(q.sent_at) : <span className="muted">Not sent</span>}</td>
                    <td data-priority="3">{q.needed_by ? formatDate(q.needed_by) : <span className="muted">—</span>}</td>
                    <td>{q.certificates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      {adding && (
        <Modal open title={adding === 'requirement' ? 'Add an insurance requirement' : 'Add a certificate of insurance'} size="lg" onClose={() => setAdding(null)}>
          <ResourceForm
            type={adding === 'requirement' ? 'insurance_requirement' : 'insurance_certificate'}
            fields={adding === 'requirement'
              ? ['line', 'min_per_occurrence', 'min_aggregate', 'additional_insured', 'waiver_of_subrogation', 'title', 'notes']
              : ['line', 'insurer_name', 'policy_number', 'effective_on', 'expires_on', 'limit_per_occurrence', 'limit_aggregate', 'additional_insured', 'waiver_of_subrogation', 'received_on', 'status', 'owner_id', 'notes']}
            initial={{ contract_id: contractId, ...(adding === 'certificate' && vendorId ? { vendor_id: vendorId } : {}) }}
            onCancel={() => setAdding(null)}
            onSaved={() => { toast.success(adding === 'requirement' ? 'Requirement added.' : 'Certificate added.'); setAdding(null); reload(); }}
          />
        </Modal>
      )}
      {asking && <AskDialog open contractId={contractId} vendorId={vendorId} lines={[...new Set(data.requirements.map((r) => r.line))]} onClose={() => setAsking(false)} onDone={() => reload()} />}
    </div>
  );
}
