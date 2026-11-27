// Vendors list and the vendor record, laid out as a profile.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, cx, EditableSummary, EmptyState, ErrorState, formatDate, Icon, Loading, LookupChip, RecordPage, relativeTime,
  ResourceList, StatusChip, useAuth, useFetch, useResource,
} from '../../core';
import type { IconName, ListResult, Row } from '../../core';
import { AssessmentTab, ScoreRing, scoreColor, scoreWord } from './Assessment';
import { Checklist } from './Checklist';
import { Contacts } from './Contacts';
import { IntakeTab, RiskTierChip } from './Intake';
import { LifecycleTab } from './Lifecycle';
import { AddEvidence } from './EvidenceForm';
import {
  ActionsTab, CoverageMeter, ExpiryChip, NoticeChip, contractName, daysPhrase, daysUntil, ifWeDoNothing, noticeTone,
  useActionsAvailable,
} from './shared';
import type { VendorOverview, VendorSummary } from './shared';

export function VendorList() {
  const { can } = useAuth();
  const overview = useFetch<VendorOverview>('/api/vendors/overview');
  const seesContracts = can('contracts.view');
  const facts = (row: Row) => overview.data?.vendors[row.id];
  return (
    <ResourceList
      type="vendor"
      title="Vendors"
      columns={[
        'ref', 'name', 'criticality', 'risk_tier', 'status',
        ...(seesContracts ? [
          {
            field: 'security_terms', label: 'Security terms',
            render: (row: Row) => {
              const f = facts(row);
              return f && f.contracts > 0 ? <CoverageMeter terms={f.terms} compact /> : <span className="muted">No contract</span>;
            },
          },
          {
            field: 'next_notice', label: 'Next notice date',
            render: (row: Row) => {
              const f = facts(row);
              return f?.notice_date ? <NoticeChip date={f.notice_date} /> : <span className="muted">—</span>;
            },
          },
        ] : []),
        'services',
        { field: 'owner_id', hidden: true }, { field: 'next_assessment_due', hidden: true }, { field: 'last_exclusion_check_on', hidden: true },
        { field: 'remote_access_method', hidden: true }, { field: 'incident_contact_name', hidden: true },
        { field: 'incident_contact_phone', hidden: true }, { field: 'updated_at', hidden: true },
      ]}
      filters={['criticality', 'risk_tier', 'status', 'owner_id', 'next_assessment_due']}
      bulkFields={['criticality', 'status', 'owner_id']}
      createFields={[
        'name', 'services', 'criticality', 'status', 'owner_id', 'remote_access_method',
        'incident_contact_name', 'incident_contact_phone', 'incident_contact_email', 'notes',
      ]}
      actions={(
        <>
          {/* Everyone who views vendors may read the questions; changing them needs administer (Questions.tsx). */}
          {can('vendors.view') && <Link className="btn btn-secondary" to="/vendors/questions">Assessment questions</Link>}
          {can('vendors.view') && <Link className="btn btn-secondary" to="/vendors/intake">Intake questions</Link>}
          {seesContracts && <Link className="btn btn-secondary" to="/vendors/terms">Security terms matrix</Link>}
        </>
      )}
    />
  );
}

/* ---------- the profile: the facts that matter, at a glance ---------- */

function Fact({ icon, title, tone, to, linkLabel, children }: {
  icon: IconName; title: string; tone?: string; to?: string; linkLabel?: string; children: ReactNode;
}) {
  return (
    <section className={cx('vnd-fact', tone && `vnd-fact-${tone}`)}>
      <h2 className="vnd-fact-title"><Icon name={icon} size={15} /> {title}</h2>
      <div className="vnd-fact-body">{children}</div>
      {to && linkLabel && <Link className="vnd-fact-link" to={to}>{linkLabel} <Icon name="arrow-right" size={14} /></Link>}
    </section>
  );
}

function Profile({ row, version }: { row: Row; version: number }) {
  const { data, error, reload } = useFetch<VendorSummary>(`/api/vendors/${row.id}/summary${version ? `?v=${version}` : ''}`, { keepPrevious: true });
  if (error) return <ErrorState title="The profile could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={3} label="Loading the profile" />;
  const tab = (key: string) => `/vendors/${row.id}?tab=${key}`;

  // The main incident contact is on the vendor itself; contacts marked "Incident contact" follow.
  const people = [
    ...(row.incident_contact_name || row.incident_contact_phone || row.incident_contact_email
      ? [{ name: row.incident_contact_name as string | null, role: null as string | null, email: row.incident_contact_email as string | null, phone: row.incident_contact_phone as string | null }]
      : []),
    ...data.incident_contacts.filter((c) => c.name !== row.incident_contact_name),
  ];
  // A passed notice date on an open contract is the most urgent state, so it is the headline (E18-75).
  const passedDate = data.last_passed_notice_date ?? null;
  const headline = passedDate ?? data.next_notice_date;
  const headlineContract = passedDate ? data.last_passed_contract : data.next_notice_contract;
  const next = data.next_notice_date;
  const assessed = data.assessment;
  const evidenceBad = data.evidence_expired > 0;

  return (
    <div className="vnd-profile">
      <Fact icon="alert-circle" title="In an incident, call" tone={people.length ? 'call' : 'warn'} to={tab('contacts')} linkLabel="All contacts">
        {people.length === 0 ? (
          <>
            <p className="vnd-fact-big vnd-fact-missing">Nobody recorded</p>
            <p className="muted">Add the person to reach when something goes wrong.</p>
          </>
        ) : people.slice(0, 2).map((p, i) => (
          <div key={i} className="vnd-call">
            <span className="vnd-call-name">{p.name ?? 'Incident contact'}{p.role && <span className="muted"> · {p.role}</span>}</span>
            {p.phone && <a className="vnd-call-phone" href={`tel:${p.phone}`}>{p.phone}</a>}
            {p.email && <a href={`mailto:${p.email}`}>{p.email}</a>}
          </div>
        ))}
        {people.length > 2 && <p className="muted">and {people.length - 2} more</p>}
      </Fact>

      {data.sees_contracts && (
        <Fact
          icon="calendar" title="Contracts and next notice date"
          tone={data.notice_dates_passed ? 'red' : next ? noticeTone(next) : undefined}
          to={tab('contracts')} linkLabel={`${data.contracts} contract${data.contracts === 1 ? '' : 's'}`}
        >
          {headline ? (
            <>
              <p className="vnd-fact-big">{formatDate(headline)}</p>
              <p><NoticeChip date={headline} /></p>
              {headlineContract && (
                <>
                  <p><Link to={`/contracts/${headlineContract.id}`}>{contractName(headlineContract)}</Link></p>
                  <p className="muted"><strong>If we do nothing:</strong> {ifWeDoNothing({ ...headlineContract, notice_date: headline })}</p>
                </>
              )}
              {passedDate && next && <p className="muted">Next notice date: {formatDate(next)}</p>}
            </>
          ) : (
            <>
              <p className={cx('vnd-fact-big', 'vnd-fact-missing')}>{data.contracts_open ? 'No notice date' : data.contracts ? 'No open contract' : 'No contract'}</p>
              <p className="muted">
                {data.contracts_open ? 'Nothing is on the renewal calendar for this vendor.' : 'Add the contract to track its dates and security terms.'}
              </p>
            </>
          )}
          {data.notice_dates_passed > 1 && <p><StatusChip color="red" label={`${data.notice_dates_passed} notice date${data.notice_dates_passed === 1 ? '' : 's'} passed`} /></p>}
          {data.contracts_undated > 0 && headline && <p className="muted">{data.contracts_undated} open with no notice date</p>}
        </Fact>
      )}

      {data.sees_contracts && (
        <Fact icon="shield" title="Security terms" to={tab('terms')} linkLabel="Open the checklist">
          {data.contracts === 0
            ? <p className="muted">Security terms are checked on each contract. None is recorded yet.</p>
            : (
              <>
                <p className="vnd-fact-big">
                  {data.terms.present}<span className="vnd-fact-of"> of {data.terms.present + data.terms.partial + data.terms.absent + data.terms.not_assessed} present</span>
                </p>
                <CoverageMeter terms={data.terms} />
              </>
            )}
        </Fact>
      )}

      <Fact
        icon="clipboard" title="Evidence" tone={evidenceBad ? 'red' : data.evidence_expiring ? 'amber' : undefined}
        to={tab('evidence')} linkLabel={`${data.evidence} on file`}
      >
        {data.evidence === 0 ? (
          <>
            <p className="vnd-fact-big vnd-fact-missing">None on file</p>
            <p className="muted">No assurance report, certificate or questionnaire has been recorded.</p>
          </>
        ) : (
          <>
            <p className="vnd-fact-big">{data.evidence_current}<span className="vnd-fact-of"> current</span></p>
            <p className="vnd-fact-chips">
              {data.evidence_expired > 0 && <StatusChip color="red" label={`${data.evidence_expired} expired`} />}
              {data.evidence_expiring > 0 && <StatusChip color="amber" label={`${data.evidence_expiring} expiring in 90 days`} />}
              {!data.evidence_expired && !data.evidence_expiring && <StatusChip color="green" label="Nothing expiring soon" />}
            </p>
            <p className="muted">
              {data.evidence_latest_received
                ? `Newest received ${formatDate(data.evidence_latest_received)} (${daysPhrase(daysUntil(data.evidence_latest_received))})`
                : 'No received date recorded'}
            </p>
          </>
        )}
      </Fact>

      <Fact icon="check-square" title="Assessment" tone={assessed.id ? scoreColor(assessed.score) : undefined} to={tab('assessment')} linkLabel={assessed.id ? 'Open the assessment' : 'Start an assessment'}>
        {assessed.id ? (
          <div className="vnd-fact-score">
            <ScoreRing score={assessed.score} size={72} />
            <div>
              <p><strong>{scoreWord(assessed.score)}</strong></p>
              <p className="muted">{assessed.gaps} gap{assessed.gaps === 1 ? '' : 's'} · {formatDate(assessed.assessed_on)}</p>
              {assessed.draft_id && <p className="muted">A new one is in progress</p>}
            </div>
          </div>
        ) : (
          <>
            <p className="vnd-fact-big vnd-fact-missing">{assessed.draft_id ? 'In progress' : 'Not assessed'}</p>
            <p className="muted">{assessed.draft_id ? 'An assessment has been started but not completed.' : 'No security questionnaire has been completed.'}</p>
          </>
        )}
      </Fact>
    </div>
  );
}

function About({ row }: { row: Row }) {
  const system = useResource('system');
  const systems = useFetch<ListResult<Row>>(system?.fields.vendor_id ? `${system.path}?f.vendor_id=${row.id}&pageSize=1` : null);
  return (
    <dl className="vnd-about">
      <div className="vnd-about-wide">
        <dt>What they supply</dt>
        <dd>{row.services || <span className="muted">Not described yet</span>}</dd>
      </div>
      <div>
        <dt>Criticality</dt>
        <dd>{row.criticality ? <LookupChip list="vendor_criticality" value={row.criticality} /> : <span className="muted">Not set</span>}</dd>
      </div>
      <div>
        <dt>Remote access</dt>
        <dd>{row.remote_access_method || <span className="muted">None recorded</span>}</dd>
      </div>
      {systems.data && (
        <div>
          <dt>Systems supplied</dt>
          <dd><Link to={`/vendors/${row.id}?tab=systems`}>{systems.data.total} system{systems.data.total === 1 ? '' : 's'}</Link></dd>
        </div>
      )}
      <div>
        <dt>Last changed</dt>
        <dd>{relativeTime(row.updated_at)}</dd>
      </div>
    </dl>
  );
}

/* ---------- tabs ---------- */

function ContractsTab({ vendorId }: { vendorId: string }) {
  return (
    <ResourceList
      type="contract"
      baseFilter={{ vendor_id: vendorId }}
      columns={[
        'ref', 'title', 'status',
        { field: 'notice_date', label: 'Notice date', sortable: true, render: (row) => <NoticeChip date={row.notice_date} status={row.status} /> },
        'end_date', 'renewal_mechanism', 'total_value', { field: 'owner_id', hidden: true },
      ]}
      filters={['status', 'renewal_mechanism']}
      bulkFields={['status', 'owner_id']}
      createFields={['title', 'document_type', 'status', 'start_date', 'end_date', 'renewal_mechanism', 'notice_days', 'owner_id']}
      createInitial={{ vendor_id: vendorId }}
    />
  );
}

function TermsTab({ vendorId, onChanged }: { vendorId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const allowed = can('contracts.view');
  const { data, error, reload } = useFetch<ListResult<Row>>(
    allowed ? `/api/contracts?f.vendor_id=${vendorId}&sort=title&pageSize=100` : null,
  );
  if (!allowed) return <EmptyState icon="lock" title="No access to contracts" message="Security terms are recorded on contracts, which you cannot view." />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} label="Loading security terms" />;
  if (!data.rows.length) {
    return (
      <EmptyState
        icon="shield" title="No contracts to check"
        message="Security terms are checked contract by contract. Add a contract on the Contracts tab first."
      />
    );
  }
  return (
    <div className="stack">
      {data.rows.map((c) => (
        <Card
          key={c.id}
          title={<>{c.ref && <span className="ref">{c.ref} </span>}{c.title}</>}
          actions={<Link className="btn btn-ghost btn-sm" to={`/contracts/${c.id}`}>Open contract</Link>}
        >
          <Checklist contractId={c.id} onChanged={onChanged} />
        </Card>
      ))}
    </div>
  );
}

function EvidenceTab({ vendorId, onChanged }: { vendorId: string; onChanged: () => void }) {
  const [version, setVersion] = useState(0); // remounts the list after an item is added
  return (
    <ResourceList
      key={version}
      type="evidence_item"
      baseFilter={{ vendor_id: vendorId }}
      columns={[
        'title', 'type', 'contract_id', 'received_on',
        { field: 'expires_on', label: 'Expiry', sortable: true, render: (row) => <ExpiryChip date={row.expires_on} /> },
      ]}
      filters={['type', 'expires_on']}
      bulkFields={[]}
      actions={<AddEvidence vendorId={vendorId} onCreated={() => { setVersion((n) => n + 1); onChanged(); }} />}
    />
  );
}

const SYSTEM_COLUMNS = ['ref', 'name', 'function', 'criticality', 'criticality_tier', 'hosting', 'status'];

function SystemsTab({ vendorId }: { vendorId: string }) {
  const system = useResource('system');
  if (!system || !system.fields.vendor_id) {
    return (
      <EmptyState
        icon="server" title="Systems are not available"
        message="The systems inventory is not switched on, or you do not have access to it."
      />
    );
  }
  const columns = SYSTEM_COLUMNS.filter((f) => f === system.refField || f === system.titleField || system.fields[f]);
  return <ResourceList type="system" baseFilter={{ vendor_id: vendorId }} columns={columns.length ? columns : [system.titleField]} bulkFields={[]} />;
}

export function VendorDetail() {
  const { can } = useAuth();
  const actions = useActionsAvailable();
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((n) => n + 1);
  return (
    <RecordPage
      type="vendor"
      status={(row) => (
        <span className="row">
          {row.criticality && <LookupChip list="vendor_criticality" value={row.criticality} />}
          <RiskTierChip value={row.risk_tier} />
          <LookupChip list="vendor_status" value={row.status} />
        </span>
      )}
      subtitle={(row) => row.services || 'No description of what this vendor supplies yet.'}
      actions={() => can('contracts.view') && <Link className="btn btn-secondary" to="/vendors/terms">Security terms matrix</Link>}
      banner={({ row }) => <Profile row={row} version={version} />}
      summary={({ row, reload }) => (
        <div className="stack">
          <About row={row} />
          <EditableSummary
            type="vendor" row={row} onSaved={() => { reload(); changed(); }}
            fields={[
              'name', 'services', 'criticality', 'status', 'owner_id', 'remote_access_method',
              'incident_contact_name', 'incident_contact_phone', 'incident_contact_email', 'notes',
            ]}
            sections={[
              { title: 'About the vendor', fields: ['name', 'services', 'criticality', 'status', 'owner_id', 'remote_access_method'] },
              {
                title: 'Incident contact', description: 'The main person to reach when something goes wrong. Add others on the Contacts tab.',
                fields: ['incident_contact_name', 'incident_contact_phone', 'incident_contact_email'],
              },
              { title: 'Notes', fields: ['notes'] },
            ]}
          />
        </div>
      )}
      tabs={[
        { key: 'contracts', label: 'Contracts', content: ({ row }) => <ContractsTab vendorId={row.id} /> },
        { key: 'terms', label: 'Security terms', content: ({ row }) => <TermsTab vendorId={row.id} onChanged={changed} /> },
        { key: 'evidence', label: 'Evidence', content: ({ row }) => <EvidenceTab vendorId={row.id} onChanged={changed} /> },
        { key: 'assessment', label: 'Assessment', content: ({ row }) => <AssessmentTab vendorId={row.id} onChanged={changed} /> },
        { key: 'intake', label: 'Intake and checks', content: ({ row }) => <IntakeTab vendorId={row.id} onChanged={changed} /> },
        { key: 'lifecycle', label: 'Lifecycle', content: ({ row }) => <LifecycleTab row={row} onChanged={changed} /> },
        { key: 'contacts', label: 'Contacts', content: ({ row }) => <Contacts vendorId={row.id} onChanged={changed} /> },
        { key: 'systems', label: 'Systems supplied', content: ({ row }) => <SystemsTab vendorId={row.id} /> },
        ...(actions ? [{ key: 'actions', label: 'Actions', content: ({ row }: { row: Row }) => <ActionsTab sourceType="vendor" sourceId={row.id} /> }] : []),
      ]}
    />
  );
}
