// OT on inventory pages (E33-01, wave 11 contract C2): an "OT" tab on a system and an OT section on an
// asset, with the record's OT fields and its security zone (a link to the zone's page). Left out while
// the OT area is switched off.
import { useEffect, useState } from 'react';
import { api, EditableSummary } from '../../core';
import type { Row } from '../../core';
import type { InventoryPanelDef, InventoryPanelProps } from '../inventory/Extensions';

const SYSTEM_FIELDS = ['ot_system', 'control_level', 'safety_related', 'zone_id', 'vendor_remote_access', 'remote_access_path', 'patchability', 'field_location'];
const ASSET_FIELDS = ['ot_asset', 'control_level', 'safety_related', 'zone_id', 'firmware_version'];

function OtPanel({ recordType, recordId, row }: InventoryPanelProps) {
  const [current, setCurrent] = useState<Row>(row as Row);
  useEffect(() => { setCurrent(row as Row); }, [row]);
  const path = recordType === 'system' ? 'systems' : 'assets';
  const reload = () => { void api.get<Row>(`/api/${path}/${recordId}`).then(setCurrent, () => {}); };
  return (
    <EditableSummary type={recordType} row={current} onSaved={reload} title="Operational technology (OT)"
      fields={recordType === 'system' ? SYSTEM_FIELDS : ASSET_FIELDS} />
  );
}

export const panels: InventoryPanelDef[] = [
  { key: 'ot', label: 'OT', area: 'ot', appliesTo: ['system', 'asset'], Panel: OtPanel },
];
