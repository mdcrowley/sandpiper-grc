// Extension file (inventory/Extensions.tsx): buttons in the bulk bar of inventory and fleet lists when
// rows are selected. Owner: TAGS-PRINT. "Print tags" opens Administration > Asset tags > Print tags
// with the selected records, to reprint their current tags (records without a tag are left out there).
import { useNavigate } from 'react-router-dom';
import { Button } from '../../core';
import type { BulkActionDef, BulkActionProps } from '../inventory/Extensions';
import type { PrintRecordsState } from './Print';

const PLURAL: Record<string, string> = { asset: 'assets', site: 'sites', system: 'systems', vehicle: 'vehicles' };

function PrintSelected({ recordType, rows }: BulkActionProps) {
  const navigate = useNavigate();
  const ids = rows.map((r) => String(r.id)).filter(Boolean);
  const print: PrintRecordsState = { recordType, recordIds: ids, typeLabel: PLURAL[recordType] ?? 'records' };
  return (
    <Button size="sm" icon="tag" disabled={!ids.length} onClick={() => navigate('/admin/asset-tags/print', { state: { print } })}>
      Print tags
    </Button>
  );
}

export const bulkActions: BulkActionDef[] = [
  { key: 'print-tags', area: 'tags', permission: 'tags.manage', appliesTo: ['asset', 'site', 'system', 'vehicle'], Action: PrintSelected },
];
