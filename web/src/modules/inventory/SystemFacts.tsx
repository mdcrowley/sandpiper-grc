// The system fact sheet: key facts at a glance, how complete the record is, and one card per subject.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Badge, Group, Paper, RingProgress, SimpleGrid, Text, UnstyledButton } from '@mantine/core';
import {
  Button, Card, fieldMeta, FieldValue, Icon, LookupChip, ResourceForm, useAuth, useResource, useToast,
} from '../../core';
import type { IconName, ResourceMeta, Row } from '../../core';
import { plural } from './shared';

export interface FactSection {
  key: string;
  title: string;
  icon: IconName;
  fields: string[];
  hints?: Record<string, string>;
  /** Shown under the heading while the card is being edited. */
  help?: string;
}

export const FACT_SECTIONS: FactSection[] = [
  { key: 'purpose', title: 'Purpose', icon: 'info', fields: ['name', 'function', 'users', 'system_group', 'status'],
    hints: { function: 'What the system is for, in a sentence.', users: 'Who uses it, for example "Finance" or "All staff".', system_group: 'A heading used to sort systems, such as "Finance". The map groups by it.' } },
  { key: 'ownership', title: 'Ownership', icon: 'users', fields: ['business_owner_id', 'technical_owner_id'],
    hints: { business_owner_id: 'Decides what the system must do and accepts its risks.', technical_owner_id: 'Keeps it running and is called when it fails.' } },
  { key: 'recovery', title: 'Criticality and recovery', icon: 'clock', fields: ['criticality_tier', 'rto_hours', 'rpo_hours', 'manual_fallback'],
    hints: { rto_hours: 'How long the organization can do without the system.', rpo_hours: 'How much recent data it can afford to lose.', manual_fallback: 'How work carries on while the system is down.' } },
  { key: 'hosting', title: 'Hosting', icon: 'server', fields: ['hosting_type', 'hosting_provider', 'hosting_region', 'hosting_notes'] },
  { key: 'signin', title: 'Sign-in', icon: 'key', fields: ['authentication_method', 'mfa_status'],
    hints: { authentication_method: 'For example single sign-on, or its own user names and passwords.', mfa_status: 'Whether sign-in needs a second factor.' } },
  { key: 'vendor', title: 'Vendor and contract', icon: 'building', fields: ['vendor_id', 'vendor_name', 'contract_id', 'agreement_on_file'],
    hints: { vendor_name: 'Free text for when no vendor record exists yet.' } },
  { key: 'outlook', title: 'Outlook and notes', icon: 'file-text', fields: ['planned_replacement', 'status_outlook', 'sensitive_data_held', 'to_confirm', 'source', 'notes'] },
];

export interface FactCheck { key: string; label: string; section: string; done: boolean }

const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

/** The key facts every system record should hold. `dataCount` is undefined when the reader may not see data categories. */
export function factChecks(row: Row, resource: ResourceMeta | undefined, dataCount: number | undefined): FactCheck[] {
  const checks: FactCheck[] = [
    { key: 'function', label: 'what it is for', section: 'purpose', done: filled(row.function) },
    { key: 'business_owner_id', label: 'a business owner', section: 'ownership', done: filled(row.business_owner_id) },
    { key: 'technical_owner_id', label: 'a technical owner', section: 'ownership', done: filled(row.technical_owner_id) },
    { key: 'criticality_tier', label: 'the criticality', section: 'recovery', done: filled(row.criticality_tier) },
    { key: 'rto_hours', label: 'a recovery time objective', section: 'recovery', done: filled(row.rto_hours) },
    { key: 'rpo_hours', label: 'a recovery point objective', section: 'recovery', done: filled(row.rpo_hours) },
    { key: 'hosting_type', label: 'the hosting', section: 'hosting', done: filled(row.hosting_type) },
    { key: 'authentication_method', label: 'how people sign in', section: 'signin', done: filled(row.authentication_method) },
    { key: 'mfa_status', label: 'the multi-factor status', section: 'signin', done: filled(row.mfa_status) && row.mfa_status !== 'unknown' },
    { key: 'vendor', label: 'the vendor', section: 'vendor', done: filled(row.vendor_id) || filled(row.vendor_name) },
  ];
  if (resource?.fields.contract_id) checks.push({ key: 'contract_id', label: 'the contract', section: 'vendor', done: filled(row.contract_id) });
  if (dataCount !== undefined) checks.push({ key: 'data', label: 'the data it holds', section: 'data', done: dataCount > 0 });
  return checks;
}

function KeyFact({ label, children, missing }: { label: string; children: ReactNode; missing?: boolean }) {
  return (
    <div className={`inv-keyfact${missing ? ' inv-keyfact-missing' : ''}`}>
      <dt>{label}</dt>
      <dd>{missing ? 'Not recorded' : children}</dd>
    </div>
  );
}

/** The band under the page header: completeness ring, the facts people look for first, and nudges for the gaps. */
export function FactStrip({ row, checks, canEdit, onFill }: { row: Row; checks: FactCheck[]; canEdit: boolean; onFill: (check: FactCheck) => void }) {
  const done = checks.filter((c) => c.done).length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 100;
  const gaps = checks.filter((c) => !c.done);
  const color = pct === 100 ? 'green' : pct >= 60 ? 'amber' : 'red';
  const hours = (v: unknown) => (filled(v) ? `${v} h` : '—');
  return (
    <Paper withBorder radius="lg" className="inv-strip">
      <div className="inv-strip-main">
        <RingProgress
          size={92} thickness={9} roundCaps sections={[{ value: pct, color }]} rootColor="var(--surface-2)"
          label={<Text ta="center" fw={700} size="lg" aria-hidden="true">{pct}%</Text>}
          role="img" aria-label={`Fact sheet ${pct}% complete`}
        />
        <div className="inv-strip-text">
          <Text fw={650}>{pct === 100 ? 'Fact sheet complete' : `Fact sheet ${pct}% complete`}</Text>
          <Text c="dimmed" size="sm">{done} of {checks.length} key facts recorded{gaps.length ? '. Still to record:' : '.'}</Text>
          {gaps.length > 0 && (
            <Group gap={6} mt={6}>
              {gaps.map((g) => (canEdit ? (
                <UnstyledButton key={g.key} className="inv-nudge" onClick={() => onFill(g)}>
                  <Icon name="plus" size={12} /> {g.label}
                </UnstyledButton>
              ) : <span key={g.key} className="inv-nudge inv-nudge-static">{g.label}</span>))}
            </Group>
          )}
        </div>
      </div>
      <dl className="inv-keyfacts">
        <KeyFact label="Business owner" missing={!filled(row.business_owner_id)}>{row._display?.business_owner_id}</KeyFact>
        <KeyFact label="Technical owner" missing={!filled(row.technical_owner_id)}>{row._display?.technical_owner_id}</KeyFact>
        <KeyFact label="Criticality" missing={!filled(row.criticality_tier)}><LookupChip list="criticality_tier" value={row.criticality_tier} /></KeyFact>
        <KeyFact label="Hosting" missing={!filled(row.hosting_type)}><LookupChip list="hosting_type" value={row.hosting_type} /></KeyFact>
        <KeyFact label="Recovery time / point" missing={!filled(row.rto_hours) && !filled(row.rpo_hours)}>{hours(row.rto_hours)} / {hours(row.rpo_hours)}</KeyFact>
        <KeyFact label="Multi-factor" missing={!filled(row.mfa_status)}><LookupChip list="mfa_status" value={row.mfa_status} /></KeyFact>
        <KeyFact label="Vendor" missing={!filled(row.vendor_id) && !filled(row.vendor_name)}>{row._display?.vendor_id ?? row.vendor_name}</KeyFact>
      </dl>
    </Paper>
  );
}

function FactCard({ section, row, gaps, canEdit, editing, onEdit, onSaved }: {
  section: FactSection; row: Row; gaps: FactCheck[]; canEdit: boolean; editing: boolean;
  onEdit: (on: boolean) => void; onSaved: () => void;
}) {
  const resource = useResource('system');
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [editing]);
  if (!resource) return null;
  const fields = section.fields.filter((f) => resource.fields[f]);
  const gapKeys = new Set(gaps.map((g) => (g.key === 'vendor' ? 'vendor_id' : g.key)));
  const title = (
    <span className="inv-fact-title"><Icon name={section.icon} size={16} /> {section.title}</span>
  );
  const state = gaps.length
    ? <Badge color="amber" variant="light">{gaps.length} to record</Badge>
    : section.key !== 'outlook' && <Badge color="green" variant="light" leftSection={<Icon name="check" size={11} />}>Complete</Badge>;
  return (
    <div ref={ref} id={`fact-${section.key}`} className="inv-fact">
      <Card
        title={title}
        actions={!editing && (
          <>
            {state}
            {canEdit && <Button size="sm" icon="edit" onClick={() => onEdit(true)}>Edit<span className="sr-only"> {section.title}</span></Button>}
          </>
        )}
      >
        {editing ? (
          <ResourceForm
            type="system" id={row.id} fields={fields} initial={row} hints={section.hints}
            onCancel={() => onEdit(false)}
            onSaved={() => { onEdit(false); toast.success('Changes saved.'); onSaved(); }}
          />
        ) : (
          <dl className="inv-facts">
            {fields.filter((f) => f !== 'name').map((f) => {
              const meta = fieldMeta(resource, f);
              const empty = !filled(row[f]) || (f === 'mfa_status' && row[f] === 'unknown');
              const gap = gapKeys.has(f) && empty;
              const long = meta.type === 'longtext' && String(row[f] ?? '').length > 60;
              return (
                <div key={f} className={`inv-fact-row${long ? ' inv-fact-row-wide' : ''}`}>
                  <dt>{meta.label}</dt>
                  <dd>
                    {gap ? <span className="inv-gap"><Icon name="alert-circle" size={14} /> Not recorded</span>
                      : !filled(row[f]) ? <span className="muted">—</span>
                      : <FieldValue resource={resource} field={f} row={row} />}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </Card>
    </div>
  );
}

/** One card per subject. `editKey` (owned by the page) says which card is open for editing. */
export function FactSheet({ row, checks, editKey, setEditKey, onSaved }: {
  row: Row; checks: FactCheck[]; editKey: string | null; setEditKey: (key: string | null) => void; onSaved: () => void;
}) {
  const { can } = useAuth();
  const canEdit = can('systems.edit');
  const done = checks.filter((c) => c.done).length;
  return (
    <div className="stack">
      <Text c="dimmed" size="sm">
        {done === checks.length
          ? 'Every key fact is recorded. Review the sheet when the system, its owner or its contract changes.'
          : `${plural(checks.length - done, 'key fact')} still to record. Cards with gaps are marked; reports and the relationship map are only as good as what is written here.`}
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" className="inv-fact-grid">
        {FACT_SECTIONS.map((s) => (
          <FactCard
            key={s.key} section={s} row={row} canEdit={canEdit}
            gaps={checks.filter((c) => c.section === s.key && !c.done)}
            editing={editKey === s.key} onEdit={(on) => setEditKey(on ? s.key : null)} onSaved={onSaved}
          />
        ))}
      </SimpleGrid>
    </div>
  );
}
