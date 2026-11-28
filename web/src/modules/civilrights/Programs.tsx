// Civil rights programs: the list with the area's figures, and one program with its required elements
// (each with evidence from the library), public notices, language assistance plan items, monitoring
// reports and complaints. Program templates are listed on their own tab.
import { Suspense, useState } from 'react';
import {
  Button, EditableSummary, ErrorState, formatDate, Loading, LookupChip, Modal, PageHeader, RecordPage, ResourceList, useAuth,
} from '../../core';
import type { Row } from '../../core';
import { ChildTable, type ChildField } from './ChildTable';
import { DueChip, Figure, LazyEvidence, pct, useEvidenceOn, useSummary } from './shared';
import './civilrights.css';

const PROGRAM_CREATE = ['name', 'program_type', 'template_id', 'owner_id', 'adopted_on', 'update_cycle_months', 'document_id', 'decision_id', 'description'];
const REPORT_COLUMNS = ['ref', 'title', 'report_type', 'period_label', 'due_on', 'status', 'submitted_on', 'owner_id'];
const REPORT_CREATE = ['title', 'program_id', 'report_type', 'period_label', 'due_on', 'every_months', 'owner_id', 'recipient', 'notes'];

function AreaFigures() {
  const { data, error, reload } = useSummary();
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={1} />;
  const { programs: p, complaints: c, goal } = data;
  return (
    <div className="cr-figures" role="group" aria-label="Civil rights figures">
      <Figure value={p.total} label="Programs" />
      <Figure value={p.update_overdue} label="Updates overdue" tone={p.update_overdue ? 'red' : undefined} />
      <Figure value={p.reports_overdue} label="Reports overdue" tone={p.reports_overdue ? 'red' : undefined} />
      <Figure value={p.reports_due_soon} label="Reports due in 30 days" tone={p.reports_due_soon ? 'amber' : undefined} />
      <Figure value={c.open} label="Open complaints" />
      <Figure value={c.overdue} label="Complaints overdue" tone={c.overdue ? 'red' : undefined} />
      {goal && <Figure value={pct(goal.attainment_pct)} label={`Participation (goal ${pct(goal.goal_pct)})`} tone={goal.met === false ? 'amber' : undefined} />}
    </div>
  );
}

export function ProgramList() {
  return (
    <div className="stack">
      <PageHeader title="Civil rights" subtitle="The organization's civil rights and accessibility programs: what each requires, when it is updated and what is reported." />
      <AreaFigures />
      <ResourceList
        type="civil_rights_program"
        urlState
        columns={['ref', 'name', 'program_type', 'status', 'owner_id', 'adopted_on', { field: 'next_update_due', label: 'Next update due', priority: 1, render: (r) => <DueChip date={r.next_update_due} soonDays={60} /> }]}
        filters={['program_type', 'status', 'owner_id', 'next_update_due']}
        createFields={PROGRAM_CREATE}
      />
    </div>
  );
}

const ITEM_STATUS = (r: Row) => <LookupChip list="civil_rights_item_status" value={r.status} />;

function ElementEvidence({ program, element, onClose }: { program: Row; element: Row; onClose: () => void }) {
  return (
    <Modal open size="lg" title={`Evidence: ${element.title}`} onClose={onClose}>
      {LazyEvidence && (
        <Suspense fallback={<Loading lines={3} />}>
          <LazyEvidence recordType="civil_rights_program" recordId={String(program.id)} part={`element:${element.id}`} bare />
        </Suspense>
      )}
    </Modal>
  );
}

function ElementsTab({ program }: { program: Row }) {
  const { can } = useAuth();
  const evidenceOn = useEvidenceOn();
  const [evidenceOf, setEvidenceOf] = useState<Row | null>(null);
  const fields: ChildField[] = [
    { name: 'title', label: 'Element', kind: 'text', required: true },
    { name: 'detail', label: 'What it needs', kind: 'longtext' },
    { name: 'status', label: 'Status', kind: 'lookup', list: 'civil_rights_item_status' },
    { name: 'due_on', label: 'Due on', kind: 'date' },
    { name: 'checked_on', label: 'Checked on', kind: 'date', hint: 'The day someone last confirmed it is in place.' },
    { name: 'note', label: 'Note', kind: 'longtext' },
  ];
  return (
    <>
      <ChildTable url={`/api/civil-rights/programs/${program.id}/items`} kind="element" title="Required elements" noun="element" fields={fields}
        canEdit={can('civilrights.edit')} emptyTitle="No required elements yet"
        emptyMessage="Add what the program must contain, or make the program from a template that lists them."
        columns={[
          { label: 'Element', priority: 1, render: (r) => r.title },
          { label: 'Status', priority: 1, render: ITEM_STATUS },
          { label: 'Due', render: (r) => (r.due_on ? <DueChip date={r.due_on} done={['in_place', 'not_applicable'].includes(r.status)} /> : '') },
          { label: 'Checked', priority: 3, render: (r) => (r.checked_on ? `${formatDate(r.checked_on)}${r.checked_by_name ? ` by ${r.checked_by_name}` : ''}` : '') },
        ]}
        rowAction={evidenceOn ? (r) => <Button size="sm" variant="ghost" aria-label={`Evidence: ${r.title}`} onClick={() => setEvidenceOf(r)}>Evidence</Button> : undefined}
      />
      {evidenceOf && <ElementEvidence program={program} element={evidenceOf} onClose={() => setEvidenceOf(null)} />}
    </>
  );
}

function NoticesTab({ program }: { program: Row }) {
  const { can } = useAuth();
  const fields: ChildField[] = [
    { name: 'title', label: 'Where the notice is posted', kind: 'text', required: true, hint: 'For example "Inside every bus" or "Website, accessibility page".' },
    ...(can('sites.view') ? [{ name: 'site_id', label: 'Site', kind: 'ref' as const, to: 'site' }] : []),
    { name: 'language', label: 'Languages', kind: 'text' },
    { name: 'status', label: 'Status', kind: 'lookup', list: 'civil_rights_item_status' },
    { name: 'checked_on', label: 'Last checked on', kind: 'date' },
    { name: 'note', label: 'Note', kind: 'longtext' },
  ];
  return (
    <ChildTable url={`/api/civil-rights/programs/${program.id}/items`} kind="notice" title="Public notice locations" noun="notice location" fields={fields}
      canEdit={can('civilrights.edit')} emptyTitle="No notice locations yet" emptyMessage="List where the public can read its rights and how to complain."
      columns={[
        { label: 'Location', priority: 1, render: (r) => r.title },
        { label: 'Site', render: (r) => r.site_id_label ?? '' },
        { label: 'Languages', priority: 3, render: (r) => r.language ?? '' },
        { label: 'Status', priority: 1, render: ITEM_STATUS },
        { label: 'Last checked', render: (r) => (r.checked_on ? formatDate(r.checked_on) : <span className="muted">Never</span>) },
      ]}
    />
  );
}

function LanguageTab({ program }: { program: Row }) {
  const { can } = useAuth();
  const fields: ChildField[] = [
    { name: 'title', label: 'Item', kind: 'text', required: true, hint: 'A translated document, an interpreting service, a staff instruction…' },
    { name: 'language', label: 'Language', kind: 'text' },
    { name: 'status', label: 'Status', kind: 'lookup', list: 'civil_rights_item_status' },
    { name: 'due_on', label: 'Due on', kind: 'date' },
    { name: 'checked_on', label: 'Checked on', kind: 'date' },
    { name: 'detail', label: 'Detail', kind: 'longtext' },
  ];
  return (
    <ChildTable url={`/api/civil-rights/programs/${program.id}/items`} kind="language" title="Language assistance plan" noun="language assistance item" fields={fields}
      canEdit={can('civilrights.edit')} emptyTitle="No language assistance items yet" emptyMessage="List the translations and interpreting the plan provides."
      columns={[
        { label: 'Item', priority: 1, render: (r) => r.title },
        { label: 'Language', render: (r) => r.language ?? '' },
        { label: 'Status', priority: 1, render: ITEM_STATUS },
        { label: 'Due', priority: 3, render: (r) => (r.due_on ? <DueChip date={r.due_on} done={['in_place', 'not_applicable'].includes(r.status)} /> : '') },
      ]}
    />
  );
}

export function ProgramDetail() {
  return (
    <RecordPage
      type="civil_rights_program"
      summary={({ row, reload }) => (
        <div className="cr-summary">
          <EditableSummary type="civil_rights_program" row={row} onSaved={reload} title="Program"
            fields={['name', 'program_type', 'status', 'owner_id', 'description', 'template_id']} />
          <EditableSummary type="civil_rights_program" row={row} onSaved={reload} title="Adoption and updates"
            fields={['document_id', 'decision_id', 'adopted_on', 'update_cycle_months', 'last_updated_on', 'next_update_due']} />
        </div>
      )}
      tabs={[
        { key: 'elements', label: 'Required elements', content: ({ row }) => <ElementsTab program={row} /> },
        { key: 'notices', label: 'Public notices', content: ({ row }) => <NoticesTab program={row} /> },
        { key: 'language', label: 'Language assistance', content: ({ row }) => <LanguageTab program={row} /> },
        {
          key: 'reports', label: 'Reports',
          content: ({ row }) => (
            <ResourceList type="civil_rights_report" baseFilter={{ program_id: String(row.id) }} urlState={false}
              columns={REPORT_COLUMNS} createFields={REPORT_CREATE.filter((f) => f !== 'program_id')} createInitial={{ program_id: row.id }} />
          ),
        },
        {
          key: 'complaints', label: 'Complaints',
          content: ({ row }) => (
            <ResourceList type="civil_rights_complaint" baseFilter={{ program_id: String(row.id) }} urlState={false}
              columns={['ref', 'subject', 'received_on', 'basis', 'status', 'next_due_on']} />
          ),
        },
      ]}
    />
  );
}

export function TemplateList() {
  return (
    <div className="stack">
      <PageHeader title="Program templates" subtitle="Your own templates: the required elements and reports a new program starts with. No jurisdiction's requirements are built in." />
      <ResourceList type="civil_rights_template" urlState columns={['ref', 'name', 'program_type', 'update_cycle_months']}
        filters={['program_type']} createFields={['name', 'program_type', 'update_cycle_months', 'description', 'elements', 'reports']} />
    </div>
  );
}

export function TemplateDetail() {
  return <RecordPage type="civil_rights_template" summaryFields={['name', 'program_type', 'update_cycle_months', 'description', 'elements', 'reports']} />;
}

export { REPORT_COLUMNS, REPORT_CREATE };
