// Corrective action plans on a host record's page (E23-07, contract C1). Wave 10 step 0 stub, owned
// by the CAP agent. Host pages load it with import.meta.glob('../risks/CapPanel.tsx'), as safety's
// shared.tsx loads ActionsPanel, so a build without it shows no panel. Shows nothing yet.

export interface CapPanelProps {
  /** The host record's type, for example 'audit_finding'. */
  sourceType: string;
  /** The host record's id. */
  sourceId: string;
  /** The `action_source` value new CAPs and their actions are filed under, for example 'audit'. */
  source?: string;
}

export function CapPanel(_props: CapPanelProps) {
  return null;
}
