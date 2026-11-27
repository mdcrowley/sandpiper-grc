// Shared pieces of the audit pages: section tabs, the target picker of inspections, and the panels
// loaded from other modules (corrective action plans, file uploads) only when they are in the build.
import { lazy, Suspense, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading, RecordPicker, Select, Tabs, useLookup, useResource } from '../../core';

const SECTIONS = [
  { key: 'dashboard', label: 'Coverage', path: '/audits' },
  { key: 'plan', label: 'Audit plan', path: '/audits/plan' },
  { key: 'engagements', label: 'Audits', path: '/audits/engagements' },
  { key: 'areas', label: 'Audit universe', path: '/audits/areas' },
  { key: 'findings', label: 'Findings', path: '/audit-findings' },
  { key: 'requests', label: 'Evidence requests', path: '/audits/requests' },
  { key: 'templates', label: 'Checklists', path: '/audits/templates' },
] as const;

export function AuditTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs label="Audit sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/audits')} />
  );
}

const INSPECTION_SECTIONS = [
  { key: 'inspections', label: 'Inspections', path: '/inspections' },
  { key: 'schedules', label: 'Schedules', path: '/inspections/schedules' },
  { key: 'templates', label: 'Checklists', path: '/audits/templates' },
] as const;

export function InspectionTabs({ active }: { active: (typeof INSPECTION_SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs label="Inspection sections" active={active} tabs={INSPECTION_SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(INSPECTION_SECTIONS.find((s) => s.key === key)?.path ?? '/inspections')} />
  );
}

/** Where a finding was raised, as words. */
export const sourceLabel = (type: string | null | undefined) => (type === 'inspection' ? 'Inspection' : 'Audit');
export const sourceRoute = (type: string | null | undefined, id: string) => (type === 'inspection' ? `/inspections/${id}` : `/audits/engagements/${id}`);

/**
 * The kind of record an inspection is about, and the record itself. Only kinds whose record type
 * is part of this installation (and switched on) are offered.
 */
export function TargetPicker({ type, id, display, onChange }: {
  type: string; id: string | null; display?: string;
  onChange: (type: string, id: string | null) => void;
}) {
  const kinds = useLookup('inspection_target_type');
  const site = useResource('site');
  const vehicle = useResource('vehicle');
  const asset = useResource('asset');
  const system = useResource('system');
  const available: Record<string, unknown> = { site, vehicle, asset, system, none: true };
  const options = kinds.filter((k) => available[k.value]).map((k) => ({ value: k.value, label: k.label }));
  return (
    <>
      <Select label="Inspects" value={type} options={options} onChange={(v) => onChange(v, null)} placeholder="Choose what is inspected" />
      {type && type !== 'none' && available[type] ? (
        <RecordPicker key={type} label={`${kinds.find((k) => k.value === type)?.label ?? 'Record'} inspected`} type={type} value={id} display={display}
          onChange={(v) => onChange(type, v)} />
      ) : <div />}
    </>
  );
}

// Corrective action plans live in the risks module (contract C1): its panel, when it is in the build.
const capLoaders = import.meta.glob<{ CapPanel: ComponentType<{ sourceType: string; sourceId: string; source?: unknown }> }>('../risks/CapPanel.tsx');
const loadCaps = Object.values(capLoaders)[0];
const LazyCaps = loadCaps ? lazy(() => loadCaps().then((m) => ({ default: m.CapPanel }))) : null;

export function FindingCaps({ findingId, source }: { findingId: string; source: string }) {
  if (!LazyCaps) return null;
  return <Suspense fallback={<Loading lines={2} />}><LazyCaps sourceType="audit_finding" sourceId={findingId} source={source} /></Suspense>;
}

// Uploading photos uses the attachments module's upload helper, when it is in the build.
export interface UploadModule {
  uploadFile: (file: File, params: { record_type: string; record_id: string; kind: 'file' | 'evidence'; description?: string }, onProgress: (f: number) => void) => Promise<{ id: string; file_name: string }>;
  refusalFor: (file: File, config: { maxBytes: number; allowedExtensions: string[] } | undefined) => string | null;
}
const uploadLoaders = import.meta.glob<UploadModule>('../attachments/upload.ts');
const loadUpload = Object.values(uploadLoaders)[0];
export const uploadAvailable = Boolean(loadUpload);
export const loadUploader = (): Promise<UploadModule> | null => (loadUpload ? loadUpload() : null);
