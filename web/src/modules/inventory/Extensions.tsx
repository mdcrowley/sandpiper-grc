// Inventory extension panels (wave 11 contract C2). An optional module adds its own part to the
// system, asset, site and data-category pages without editing inventory: it ships
// `web/src/modules/<module>/InventoryPanel.tsx` exporting
//
//   export const panels: InventoryPanelDef[] = [{ key: 'ot', label: 'OT', area: 'ot', appliesTo: ['system', 'asset'], Panel }];
//
// Panels are found at build time and loaded on first use, so inventory builds and works without
// them. A panel whose area is switched off is left out (Administration > Features). On a system a
// panel is an extra tab; on an asset, site or data category it is an extra section under the summary.
// The panel checks its own permissions and renders null when the reader may see nothing of it.
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { useAuth } from '../../core';
import type { RecordTab, Row } from '../../core';

export type InventoryRecordType = 'system' | 'asset' | 'site' | 'data_category';

export interface InventoryPanelProps {
  recordType: string;
  recordId: string;
  row: Record<string, unknown>;
}

export interface InventoryPanelDef {
  /** Unique across modules, for example 'ot'; a system tab's key is `ext-<key>`. */
  key: string;
  /** The tab or section title. */
  label: string;
  /** The feature area the panel belongs to: left out while it is switched off. */
  area?: string;
  appliesTo: InventoryRecordType[];
  Panel: ComponentType<InventoryPanelProps>;
}

const loaders = import.meta.glob<{ panels?: InventoryPanelDef[] }>('../*/InventoryPanel.tsx');

let all: Promise<InventoryPanelDef[]> | null = null;

/** Every panel in the build, loaded once. A module that fails to load is skipped (and logged). */
function loadPanels(): Promise<InventoryPanelDef[]> {
  all ??= Promise.all(Object.entries(loaders).map(([file, load]) => load()
    .then((m) => m.panels ?? [])
    .catch((err) => { console.error(`Inventory panel ${file} did not load:`, err); return [] as InventoryPanelDef[]; })))
    .then((lists) => lists.flat().sort((a, b) => a.label.localeCompare(b.label)));
  return all;
}

/** The panels for one record type whose area is on; empty while they load and when there are none. */
export function useInventoryPanels(recordType: InventoryRecordType): InventoryPanelDef[] {
  const { areaOn } = useAuth();
  const [panels, setPanels] = useState<InventoryPanelDef[]>([]);
  useEffect(() => {
    if (!Object.keys(loaders).length) return undefined;
    let live = true;
    void loadPanels().then((list) => { if (live) setPanels(list); });
    return () => { live = false; };
  }, []);
  return panels.filter((p) => p.appliesTo.includes(recordType) && (!p.area || areaOn(p.area)));
}

/** Extra tabs for a record page (the system page), after its own tabs. */
export function useExtensionTabs(recordType: InventoryRecordType): RecordTab[] {
  return useInventoryPanels(recordType).map((p) => ({
    key: `ext-${p.key}`,
    label: p.label,
    content: ({ row }: { row: Row }) => <p.Panel recordType={recordType} recordId={String(row.id)} row={row} />,
  }));
}

/** Extra sections for a record page's summary (asset, site and data-category pages). */
export function ExtensionSections({ recordType, row }: { recordType: InventoryRecordType; row: Row }) {
  const panels = useInventoryPanels(recordType);
  if (!panels.length) return null;
  return (
    <>
      {panels.map((p) => <p.Panel key={p.key} recordType={recordType} recordId={String(row.id)} row={row} />)}
    </>
  );
}
