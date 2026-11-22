// The condition section on asset and site pages (wave 11 contract C2): latest rating, useful
// life, replacement and assessment history, with "Record assessment". Left out while the
// `condition` area is switched off; renders nothing for people who may not view assets.
import type { InventoryPanelDef, InventoryPanelProps } from '../inventory/Extensions';
import { ConditionSection, isTargetType } from './shared';

function ConditionPanel({ recordType, recordId }: InventoryPanelProps) {
  if (!isTargetType(recordType)) return null;
  return <ConditionSection recordType={recordType} recordId={recordId} />;
}

export const panels: InventoryPanelDef[] = [
  { key: 'condition', label: 'Condition', area: 'condition', appliesTo: ['asset', 'site'], Panel: ConditionPanel },
];
