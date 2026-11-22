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
import type { ComponentType, ReactNode } from 'react';
import { useAuth } from '../../core';
import type { RecordTab, Row } from '../../core';

/** Vehicles (fleet) take panels and list extensions too (wave 13): a vehicle panel is an extra tab. */
export type InventoryRecordType = 'system' | 'asset' | 'site' | 'data_category' | 'vehicle';

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

// ---------- list extensions (wave 13) ----------
//
// An optional module adds controls to the inventory and fleet lists without editing them:
//   `web/src/modules/<module>/ListActions.tsx` exporting `listActions: ListActionDef[]`: shown beside
//     the list's buttons (the asset tags "Find by tag number" box);
//   `web/src/modules/<module>/BulkActions.tsx` exporting `bulkActions: BulkActionDef[]`: shown in the
//     bulk bar while rows are selected (print the tags of the selected records).
// Each is left out while its area is off, and a bulk action also without its permission.

export interface ListActionProps { recordType: InventoryRecordType }

export interface ListActionDef {
  key: string;
  area?: string;
  permission?: string;
  appliesTo: InventoryRecordType[];
  Action: ComponentType<ListActionProps>;
}

export interface BulkActionProps {
  recordType: InventoryRecordType;
  /** The selected rows (as the list loaded them). */
  rows: Row[];
  /** Clears the selection (call after the action is done). */
  clear: () => void;
}

export interface BulkActionDef {
  key: string;
  area?: string;
  permission?: string;
  appliesTo: InventoryRecordType[];
  Action: ComponentType<BulkActionProps>;
}

const listLoaders = import.meta.glob<{ listActions?: ListActionDef[] }>('../*/ListActions.tsx');
const bulkLoaders = import.meta.glob<{ bulkActions?: BulkActionDef[] }>('../*/BulkActions.tsx');

function loadAll<T>(loaders: Record<string, () => Promise<Record<string, unknown>>>, name: string): Promise<T[]> {
  return Promise.all(Object.entries(loaders).map(([file, load]) => load()
    .then((m) => (m[name] as T[] | undefined) ?? [])
    .catch((err) => { console.error(`List extension ${file} did not load:`, err); return [] as T[]; })))
    .then((lists) => lists.flat());
}

let listAll: Promise<ListActionDef[]> | null = null;
let bulkAll: Promise<BulkActionDef[]> | null = null;

function useExtensionList<T extends { appliesTo: InventoryRecordType[]; area?: string; permission?: string }>(
  loaders: Record<string, unknown>, load: () => Promise<T[]>, recordType: InventoryRecordType,
): T[] {
  const { areaOn, can } = useAuth();
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    if (!Object.keys(loaders).length) return undefined;
    let live = true;
    void load().then((list) => { if (live) setItems(list); });
    return () => { live = false; };
  }, [loaders, load]);
  return items.filter((p) => p.appliesTo.includes(recordType) && (!p.area || areaOn(p.area)) && (!p.permission || can(p.permission)));
}

const loadListActions = () => (listAll ??= loadAll<ListActionDef>(listLoaders, 'listActions'));
const loadBulkActions = () => (bulkAll ??= loadAll<BulkActionDef>(bulkLoaders, 'bulkActions'));

/** Extension controls for a list's header (render beside the list's own buttons). */
export function ListExtensionActions({ recordType }: { recordType: InventoryRecordType }) {
  const items = useExtensionList(listLoaders, loadListActions, recordType);
  if (!items.length) return null;
  return <>{items.map((a) => <a.Action key={a.key} recordType={recordType} />)}</>;
}

/** Extension buttons for a list's bulk bar: pass the result as ResourceList's `bulkActions`. */
export function useBulkExtensions(recordType: InventoryRecordType): ((rows: Row[], clear: () => void) => ReactNode) | undefined {
  const items = useExtensionList(bulkLoaders, loadBulkActions, recordType);
  if (!items.length) return undefined;
  return (rows, clear) => <>{items.map((a) => <a.Action key={a.key} recordType={recordType} rows={rows} clear={clear} />)}</>;
}
