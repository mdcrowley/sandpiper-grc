// Funding awards: the list, and one award with what it paid for and the obligations it created.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EditableSummary, EmptyState, ErrorState, errorMessage, formatDate, Loading, LookupChip, Modal,
  PageHeader, RecordPage, RecordPicker, ResourceList, Select, useAuth, useFetch, useToast,
} from '../../core';
import { FundingTabs } from './shared';

const CREATE = ['title', 'funder_name', 'program_name', 'award_number', 'status', 'period_start', 'period_end', 'amount', 'local_share',
  'project_id', 'manager_id', 'reporting_frequency', 'next_report_due', 'closeout_due', 'notes'];

export function AwardList() {
  return (
    <div className="stack">
      <PageHeader title="Funding awards" subtitle="Grants and other outside funding: who pays, for what period, how much, and the reports each award requires." />
      <FundingTabs active="awards" />
      <ResourceList
        type="funding_award"
        urlState
        columns={['ref', 'title', 'funder_name', 'status', 'amount', 'local_share', 'period_end', 'next_report_due', { field: 'program_name', hidden: true },
          { field: 'award_number', hidden: true }, { field: 'manager_id', hidden: true }, { field: 'closeout_due', hidden: true }]}
        filters={['status', 'reporting_frequency', 'manager_id', 'project_id', 'period_end', 'next_report_due']}
        createFields={CREATE}
      />
    </div>
  );
}

interface FundedItem { link_id: string; type: string; type_label: string; id: string; route: string; ref: string | null; title: string; status: string | null; linked_at: string }

function FundedItems({ awardId, canEdit }: { awardId: string; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<{ items: FundedItem[]; types: { type: string; label: string }[] }>(`/api/funding-awards/${awardId}/funded-items`);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FundedItem | null>(null);
  const [busy, setBusy] = useState(false);
  const types = data?.types ?? [];

  const add = async () => {
    if (!type || !pick) return;
    setBusy(true);
    try {
      await api.post(`/api/funding-awards/${awardId}/funded-items`, { type, id: pick });
      toast.success('Recorded as funded by this award.');
      setAdding(false); setPick(null); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/funding-awards/${awardId}/funded-items/${removing.link_id}`);
      toast.success('Link removed.'); setRemoving(null); reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Card title="Funded items" flush
      actions={canEdit && types.length > 0 && <Button size="sm" icon="link" onClick={() => { setType(types[0].type); setPick(null); setAdding(true); }}>Add a funded item</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="fd-pad"><Loading lines={3} /></div>
        : data.items.length === 0 ? (
          <EmptyState icon="link" title="Nothing recorded as funded by this award"
            message={types.length ? `Link the ${types.map((t) => t.label.toLowerCase()).join(', ')} this award paid for.` : 'The kinds of record an award can pay for are not part of this installation.'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Records funded by this award</caption>
              <thead><tr><th scope="col">Record</th><th scope="col">Type</th><th scope="col">Linked</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.link_id}>
                    <td><Link className="row-title" to={i.route}>{i.ref && <span className="ref">{i.ref}</span>} {i.title}</Link></td>
                    <td>{i.type_label}</td>
                    <td>{formatDate(i.linked_at)}</td>
                    <td className="fd-actions">{canEdit && <Button size="sm" variant="ghost" onClick={() => setRemoving(i)}>Remove</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <Modal open={adding} title="Add a funded item" size="sm" onClose={() => setAdding(false)} dirty={adding && Boolean(pick)}
        footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!pick} onClick={add}>Add</Button></>}>
        <div className="stack">
          <Select label="Kind of record" required value={type} options={types.map((t) => ({ value: t.type, label: t.label }))}
            onChange={(v) => { setType(v); setPick(null); }} />
          {type && <RecordPicker key={type} label={types.find((t) => t.type === type)?.label ?? 'Record'} type={type} required value={pick} onChange={(id) => setPick(id)} />}
        </div>
      </Modal>
      <ConfirmDialog open={!!removing} title="Remove this link?" message={`${removing?.title ?? 'The record'} will no longer be recorded as funded by this award.`}
        confirmLabel="Remove" danger busy={busy} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </Card>
  );
}

interface ObligationRow { id: string; ref: string; title: string; status: string | null; next_due_on: string | null; frequency: string | null }

function ReportingObligations({ awardId, canEdit }: { awardId: string; canEdit: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<{ available: boolean; may_view: boolean; rows: ObligationRow[] }>(`/api/funding-awards/${awardId}/obligations`);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ created: string[] }>(`/api/funding-awards/${awardId}/obligations`);
      toast.success(r.created.length ? `${r.created.length} obligation${r.created.length === 1 ? '' : 's'} made.` : 'The obligations are already there.');
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const mayMake = canEdit && can('obligations.create') && data?.available;
  return (
    <Card title="Reporting obligations" flush actions={mayMake && <Button size="sm" loading={busy} onClick={make}>Make missing obligations</Button>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="fd-pad"><Loading lines={3} /></div>
        : !data.available ? <EmptyState icon="calendar" title="Obligations are not available" message="The obligations register with obligation types and frequencies is not part of this installation." />
        : !data.may_view ? <EmptyState icon="lock" title="You cannot see obligations" message="Ask for permission to view obligations to see the reports this award requires." />
        : data.rows.length === 0 ? (
          <EmptyState icon="calendar" title="No reporting obligations yet"
            message="When the award is awarded or active, its reports (at the reporting frequency) and its close-out become obligations with due dates." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Obligations made from this award</caption>
              <thead><tr><th scope="col">Obligation</th><th scope="col">Frequency</th><th scope="col">Next due</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {data.rows.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="row-title" to={`/obligations/${o.id}`}><span className="ref">{o.ref}</span> {o.title}</Link></td>
                    <td>{o.frequency ? <LookupChip list="funding_report_frequency" value={o.frequency} /> : '—'}</td>
                    <td>{formatDate(o.next_due_on)}</td>
                    <td>{o.status ? <LookupChip list="obligation_status" value={o.status} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

export function AwardDetail() {
  return (
    <RecordPage
      type="funding_award"
      breadcrumbs={[{ label: 'Funding', to: '/funding' }, { label: 'Awards', to: '/funding/awards' }]}
      summary={({ row, reload }) => (
        <EditableSummary type="funding_award" row={row} onSaved={reload}
          fields={['title', 'funder_name', 'program_name', 'award_number', 'status', 'manager_id', 'project_id', 'period_start', 'period_end',
            'amount', 'local_share', 'reporting_frequency', 'next_report_due', 'closeout_due', 'notes']}
          sections={[
            { title: 'Award', fields: ['title', 'funder_name', 'program_name', 'award_number', 'status', 'manager_id', 'project_id'] },
            { title: 'Period and money', fields: ['period_start', 'period_end', 'amount', 'local_share'] },
            { title: 'Reporting', description: 'Once the award is awarded or active, its reports and close-out become obligations.', fields: ['reporting_frequency', 'next_report_due', 'closeout_due', 'notes'] },
          ]} />
      )}
      tabs={[
        { key: 'funded', label: 'Funded items', content: ({ row, canEdit }) => <FundedItems awardId={row.id} canEdit={canEdit} /> },
        { key: 'obligations', label: 'Reporting obligations', content: ({ row, canEdit }) => <ReportingObligations awardId={row.id} canEdit={canEdit} /> },
      ]}
    />
  );
}
