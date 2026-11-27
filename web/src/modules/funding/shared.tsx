// Shared pieces of the funding pages: section tabs and the corrective action plan panel loader.
import { lazy, Suspense, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading, Tabs } from '../../core';

const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', path: '/funding' },
  { key: 'awards', label: 'Awards', path: '/funding/awards' },
  { key: 'certifications', label: 'Certifications', path: '/funding/certifications' },
  { key: 'reviews', label: 'Compliance reviews', path: '/funding/reviews' },
  { key: 'deficiencies', label: 'Deficiencies', path: '/funding/deficiencies' },
  { key: 'subrecipients', label: 'Sub-recipients', path: '/funding/subrecipients' },
  { key: 'funders', label: 'Funders', path: '/funding/funders' },
  { key: 'areas', label: 'Review areas', path: '/funding/review-areas' },
] as const;

export type FundingSection = (typeof SECTIONS)[number]['key'];

export function FundingTabs({ active }: { active: FundingSection }) {
  const navigate = useNavigate();
  return (
    <Tabs label="Funding sections" active={active} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/funding')} />
  );
}

// Corrective action plans live in the risks module (contract C1); load its panel only when it is in the build.
interface CapPanelProps { sourceType: string; sourceId: string; source?: string }
const capLoaders = import.meta.glob<{ CapPanel: ComponentType<CapPanelProps> }>('../risks/CapPanel.tsx');
const loadCaps = Object.values(capLoaders)[0];
const LazyCaps = loadCaps ? lazy(() => loadCaps().then((m) => ({ default: m.CapPanel }))) : null;

/** Whether the corrective action plan panel is part of this build. */
export const capsInBuild = Boolean(LazyCaps);

export function DeficiencyCaps({ deficiencyId }: { deficiencyId: string }) {
  if (!LazyCaps) return null;
  return <Suspense fallback={<Loading lines={3} />}><LazyCaps sourceType="review_deficiency" sourceId={deficiencyId} source="funding" /></Suspense>;
}

/** "3 of 5" style progress text. */
export const ofText = (n: number, total: number) => `${n} of ${total}`;

// The evidence library (E45-06) supplies the evidence panel: per review area and per document request.
// Loaded only when that module is in the build; shown only while its area is on.
export interface EvidencePanelProps {
  recordType: string; recordId: string; part?: string; title?: string; bare?: boolean; mayUpload?: boolean; onChange?: () => void;
  uploadTo?: (uploadId: string, form: { title: string; valid_until: string | null }) => Promise<unknown>;
}
const evidenceLoaders = import.meta.glob<{ EvidencePanel: ComponentType<EvidencePanelProps> }>('../evidence/EvidencePanel.tsx');
const loadEvidence = Object.values(evidenceLoaders)[0];
const LazyEvidence = loadEvidence ? lazy(() => loadEvidence().then((m) => ({ default: m.EvidencePanel }))) : null;

/** Whether the evidence library's panel is part of this build. */
export const evidenceInBuild = Boolean(LazyEvidence);

export function Evidence(props: EvidencePanelProps) {
  if (!LazyEvidence) return null;
  return <Suspense fallback={<Loading lines={2} label="Loading evidence" />}><LazyEvidence {...props} /></Suspense>;
}
