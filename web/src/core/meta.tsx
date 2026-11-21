import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useFetch } from './hooks';
import type { LifecycleMeta } from './lifecycle';
import { ErrorState, Loading, StatusChip } from './ui';

export type FieldType =
  | 'text' | 'longtext' | 'number' | 'currency' | 'date' | 'datetime'
  | 'boolean' | 'lookup' | 'user' | 'ref' | 'json';

export interface FieldMeta {
  label: string;
  type: FieldType;
  required?: boolean;
  readOnly?: boolean;
  /** Lookup list name, for `lookup` fields. */
  list?: string;
  /** Target record type, for `ref` fields. */
  to?: string;
  /** An administrator's own field (`cf_<key>`), shown by the generic list, form and record page automatically. */
  custom?: boolean;
  /** A `lookup` field that holds several values (an array of list values). */
  multiple?: boolean;
  /** Help text shown under the control. */
  help?: string;
  /** Heading the field is grouped under on forms. */
  section?: string;
  /** Order among custom fields. */
  position?: number;
}

/** The custom fields of a record type (`custom: true`), in their administrator-chosen order. */
export function customFieldNames(resource: { fields: Record<string, FieldMeta> } | undefined): string[] {
  if (!resource) return [];
  return Object.entries(resource.fields)
    .filter(([, f]) => f.custom)
    .sort(([an, a], [bn, b]) => (a.position ?? 0) - (b.position ?? 0) || an.localeCompare(bn))
    .map(([name]) => name);
}

export interface ResourceMeta {
  type: string;
  label: string;
  plural: string;
  /** Permission prefix: `<module>.view`, `.create`, `.edit`, `.delete`, `.export`. */
  module: string;
  /** API base, e.g. `/api/tickets`. */
  path: string;
  /** Web route, e.g. `/tickets`; the detail page is `${route}/${id}`. */
  route: string;
  titleField: string;
  refField?: string;
  restricted: boolean | 'flag';
  /** Files on this type are evidence (collection and expiry dates); the record page's file tab says so. */
  evidence?: boolean;
  fields: Record<string, FieldMeta>;
  /** Allowed status changes and fields required per status (E14-31); absent for a type without a status. */
  lifecycle?: LifecycleMeta;
}

export const COLOR_NAMES = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export interface LookupValue {
  value: string;
  label: string;
  color: ColorName;
  sort: number;
}

export interface Meta {
  resources: Record<string, ResourceMeta>;
  lookups: Record<string, LookupValue[]>;
}

interface MetaContextValue extends Meta {
  /** Re-read metadata, e.g. after an administrator edits lookup values. */
  reload: () => void;
}

const EMPTY_META: Meta = { resources: {}, lookups: {} };
const MetaContext = createContext<MetaContextValue>({ ...EMPTY_META, reload: () => {} });

// The latest metadata, so the plain helpers below work outside components (chart builders, cell renderers).
let current: Meta = EMPTY_META;

export function MetaProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useFetch<Meta>('/api/meta');
  if (data) current = data;
  useEffect(() => () => { current = EMPTY_META; }, []);

  if (!data) {
    return (
      <div className="boot">
        {error
          ? <ErrorState title="The application data could not be loaded" error={error} onRetry={reload} />
          : <Loading label="Loading" lines={3} />}
      </div>
    );
  }
  return <MetaContext.Provider value={{ ...data, reload }}>{children}</MetaContext.Provider>;
}

export function useMeta(): MetaContextValue {
  return useContext(MetaContext);
}

/** Metadata for a record type, or `undefined` when the server does not know it. */
export function useResource(type: string): ResourceMeta | undefined {
  return useMeta().resources[type];
}

/** The values of a lookup list in display order (empty when the list does not exist). */
export function useLookup(list: string): LookupValue[] {
  return useMeta().lookups[list] ?? [];
}

function find(list: string, value: unknown): LookupValue | undefined {
  return current.lookups[list]?.find((v) => v.value === value);
}

/** Label for a lookup value; falls back to the raw value. */
export function lookupLabel(list: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return find(list, value)?.label ?? String(value);
}

/** Color name for a lookup value; `gray` when unknown. */
export function lookupColor(list: string, value: unknown): ColorName {
  return toColorName(find(list, value)?.color);
}

/** Coerce any string to a valid color name. */
export function toColorName(color: string | null | undefined): ColorName {
  return (COLOR_NAMES as readonly string[]).includes(color ?? '') ? (color as ColorName) : 'gray';
}

/** A chip showing a lookup value with its configured label and color. */
export function LookupChip({ list, value }: { list: string; value: string | null | undefined }) {
  useMeta(); // re-render when lookups are reloaded
  if (value === null || value === undefined || value === '') return <span className="muted">{'—'}</span>;
  return <StatusChip color={lookupColor(list, value)} label={lookupLabel(list, value)} />;
}

/** Web path of one record: `${route}/${id}`. Accepts a route that already ends with the id. */
export function recordHref(route: string, id: string): string {
  return route.endsWith(`/${id}`) ? route : `${route.replace(/\/$/, '')}/${id}`;
}
