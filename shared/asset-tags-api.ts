// The asset tags API contract (wave 13, E37): request and response shapes shared by the server
// (modules/tags), the web application (web/src/modules/tags) and the mobile app. Types and constants
// only. The API base is `/api/asset-tags` (not `/api/tags`, which holds the free-text labels any
// record can carry); inventory counts are a record type at `/api/inventory-counts`.
//
// Import it as:
//   server  (server/src/modules/tags/x.ts):  import type { TagCard } from '../../../../shared/asset-tags-api.ts';
//   web     (web/src/modules/tags/x.tsx):     import type { TagCard } from '../../../../shared/asset-tags-api.ts';
//   mobile  (mobile/src/tags/x.ts):           import type { TagCard } from '../../../shared/asset-tags-api.ts';
import type { CheckScheme, TagCarrier, TagCharacters, TagFormat, TagSource } from './tag-format.ts';

export const ASSET_TAGS_API = '/api/asset-tags';
/** Most candidates one lookup takes (the camera sends several readings at once). */
export const MAX_LOOKUP_CANDIDATES = 10;

/** Settings of the Asset tags area (read with ctx.settings.get(key, fallback)). */
export const TAG_SETTINGS = {
  /** Several active tags per record (a long vehicle with a tag at each end). */
  severalPerRecord: { key: 'tags.several_per_record', fallback: false },
  /** Keep a log of lookups for "Last seen" (E37-10). */
  logLookups: { key: 'tags.log_lookups', fallback: true },
  /** Days the lookup log is kept. */
  lookupDays: { key: 'retention.tag_lookups_days', fallback: 90 },
  /** Most labels one print run makes. */
  printLimit: { key: 'tags.print_limit', fallback: 1000 },
} as const;

/** `GET/PUT /api/asset-tags/settings` (GET tags.view, PUT tags.manage). */
export interface TagSettingsView { severalPerRecord: boolean; logLookups: boolean; lookupDays: number; printLimit: number }

// ---------- formats (TAGS-CORE) ----------

/**
 * `GET /api/asset-tags/formats` (tags.view) → TagFormat[] (shared/tag-format.ts), active first then by name.
 * `POST` (tags.manage) TagFormatInput → TagFormat (201); `PATCH /:id` Partial<TagFormatInput> → TagFormat;
 * `DELETE /:id` (soft; refused 409 `in_use` while stock refers to it). 400 `validation` with
 * `fields.pattern` / `fields.extractPattern` carrying compileSafePattern's message.
 */
export interface TagFormatInput {
  name: string;
  characters: TagCharacters;
  pattern?: string | null;
  prefix?: string;
  lengthMin?: number | null;
  lengthMax?: number | null;
  checkCharacter?: CheckScheme;
  carrier?: TagCarrier;
  extractPattern?: string | null;
  recordTypes?: string[];
  active?: boolean;
}

/** `POST /api/asset-tags/formats/try` (tags.view): { value, source?, formatId? } → per format, whether and how it matches. */
export interface TryFormatRequest { value: string; source?: TagSource; formatId?: string }
export interface TryFormatResult {
  key: string;
  results: {
    formatId: string; name: string; ok: boolean;
    /** When not ok: empty, too_long, carrier, prefix, characters, length, check, pattern, bad_pattern. */
    reason: string | null;
    /** Plain English, for example "The check digit does not match (expected 3)." */
    message: string;
    /** For a code: what the extraction pattern took from it. */
    extracted: string | null;
  }[];
}

// ---------- stock and series (TAGS-CORE) ----------

export type StockSource = 'bought' | 'printed';

/**
 * `GET /api/asset-tags/ranges` (tags.view) → StockRange[]. `POST` (tags.manage) StockRangeInput →
 * StockRange (201), refused 409 `overlap` (with the clashing values or range) when any value is
 * already in stock or attached. `PATCH /:id` { note, supplierNote, receivedOn }. `DELETE /:id` only
 * while none of its values is attached (409 `in_use`).
 */
export type StockRangeInput =
  | { kind: 'sequence'; formatId?: string | null; prefix?: string; digits: number; first: number; last: number; source?: StockSource; supplierNote?: string; note?: string; receivedOn?: string | null }
  | { kind: 'list'; formatId?: string | null; values: string[]; source?: StockSource; supplierNote?: string; note?: string; receivedOn?: string | null };

export interface StockRange {
  id: string;
  kind: 'sequence' | 'list';
  formatId: string | null;
  formatName: string | null;
  /** First and last value as printed (a list: its first and last value in order). */
  firstValue: string;
  lastValue: string;
  size: number;
  counts: { attached: number; available: number; void: number; lost: number };
  source: StockSource;
  seriesId: string | null;
  supplierNote: string | null;
  note: string | null;
  receivedOn: string | null;
  createdAt: string;
  createdByName: string | null;
}

export type StockValueState = 'available' | 'attached' | 'replaced' | 'void' | 'lost';

/** `GET /api/asset-tags/ranges/:id/values?state=&q=&page=&pageSize=` (tags.view). */
export interface StockValuesPage {
  rows: { value: string; key: string; state: StockValueState; recordType: string | null; recordId: string | null; recordLabel: string | null; route: string | null }[];
  total: number; page: number; pageSize: number;
}

/** `POST /api/asset-tags/stock/mark` (tags.manage): mark stock values that were never attached void or lost (or `available` to undo). */
export interface StockMarkRequest { values: string[]; status: 'void' | 'lost' | 'available'; reason?: string }

/**
 * `GET /api/asset-tags/series` (tags.view) → TagSeries[]; `POST` / `PATCH /:id` (tags.manage).
 * Numbers are taken with one atomic update (`takeFromSeries` in modules/tags/store.ts), so two
 * people printing at once never get the same numbers; taken numbers are registered as a printed range.
 */
export interface TagSeries { id: string; name: string; formatId: string | null; prefix: string; digits: number; nextNumber: number; nextValue: string; active: boolean }
export interface TagSeriesInput { name: string; formatId?: string | null; prefix?: string; digits: number; nextNumber?: number; active?: boolean }

// ---------- assignments (TAGS-CORE) ----------

export type AssignmentStatus = 'active' | 'replaced' | 'void' | 'lost' | 'ended';

export interface TagAssignmentView {
  id: string;
  value: string;
  key: string;
  recordType: string;
  recordId: string;
  status: AssignmentStatus;
  primary: boolean;
  source: TagSource | 'import' | 'system' | null;
  assignedAt: string;
  assignedByName: string | null;
  endedAt: string | null;
  endedByName: string | null;
  /** For a replaced value: the value that replaced it. */
  replacedByValue: string | null;
  reason: string | null;
}

/**
 * `GET /api/asset-tags/record?type=&id=` (view on the record; the history needs tags.view) → RecordTags.
 * Used by the record page's Tags panel.
 */
export interface RecordTags {
  current: TagAssignmentView[];
  /** Earlier values, newest first (empty without tags.view). */
  earlier: TagAssignmentView[];
  /** When the record was last seen (E37-10), for people who may edit the record; null otherwise. */
  lastSeen: LastSeen | null;
  /** When the record was last verified in a count (E37-09). */
  lastVerified: { at: string; siteLabel: string | null; countId: string | null } | null;
  /** tags.manage and edit on the record, no legal hold. */
  canManage: boolean;
  held: boolean;
}

/**
 * `POST /api/asset-tags/attach` (tags.manage + edit on the record): { recordType, recordId, value, source? }
 * → TagAssignmentView (201). 409 `in_use` when the value is active elsewhere (identical for a record
 * the caller cannot see), 409 `on_hold` for a held record, 409 `one_per_record` when the record has a
 * tag and several are not allowed (use replace), 400 `validation` for a value no format accepts when formats exist and the value is typed.
 */
export interface AttachRequest { recordType: string; recordId: string; value: string; source?: TagSource }
/** `POST /api/asset-tags/replace`: the old value is marked replaced, pointing at the new one. → the new TagAssignmentView. */
export interface ReplaceRequest { assignmentId: string; value: string; source?: TagSource; reason?: string }
/** `POST /api/asset-tags/end`: end a value as void (damaged), lost, or ended (removed). → TagAssignmentView. */
export interface EndRequest { assignmentId: string; status: 'void' | 'lost' | 'ended'; reason: string }

// ---------- lookup and the tag card (TAGS-LOOKUP) ----------

/** How a candidate was read: the camera's code or text reading, typed in the app, or the web (typed or handheld scanner). */
export type LookupLogSource = 'app_code' | 'app_text' | 'app_typed' | 'web';

/**
 * The outcome for one candidate (spec §4.2), in rule order:
 *  - `current`: an active tag value → its record (cards has one).
 *  - `replaced`: an earlier value → the record (cards has one), with `replacedBy`.
 *  - `in_stock`: in stock, not attached → Attach for people who may.
 *  - `unknown_format`: matches a format but is not in stock → Attach for people who may manage tags.
 *  - `identifier`: an exact match on another identifier (serial, fleet number...) → one or more cards.
 *  - `misread`: refused before any lookup (a check character that does not match).
 *  - `nothing`: "Nothing found for <text>", identical whether the record does not exist, is restricted,
 *    is in a switched-off area (except for administrators: `switchedOff`), or the value was ended.
 */
export type LookupOutcome = 'current' | 'replaced' | 'in_stock' | 'unknown_format' | 'identifier' | 'misread' | 'nothing';

export interface LookupCandidate { value: string; source: TagSource }

/**
 * `GET /api/asset-tags/lookup?value=<text>&source=typed|handheld` (signed in; the Asset tags area on)
 * → LookupResponse with one result. `POST /api/asset-tags/lookup` { candidates: LookupCandidate[] }
 * (1 to 10; the app's camera, which also sends look-alike variants) → one result per candidate, in order.
 * A lookup is a read: no permission beyond seeing the record. Logged (tag_lookups) when logging is on.
 */
export interface LookupRequest { candidates: LookupCandidate[] }

export interface LookupResult {
  candidate: LookupCandidate;
  /** valueKey(candidate.value). */
  key: string;
  outcome: LookupOutcome;
  /** Plain English for the person, for example "Tag TA-118342 is not attached yet." */
  message: string;
  /** Records found (current, replaced: one; identifier: one or more; otherwise none). */
  cards: TagCard[];
  /** For `replaced`: the value now on the record. */
  replacedBy: string | null;
  /** For `identifier`: which field matched, for example "Serial number". */
  matchedBy: string | null;
  /** For `in_stock` and `unknown_format`: the format it matches. */
  formatId: string | null;
  /** For `in_stock`, `unknown_format`: Attach (when allowed). Otherwise empty: actions are on the cards. */
  actions: TagAction[];
  /** Administrators only: the record exists but its area is switched off. */
  switchedOff?: boolean;
}

export interface LookupResponse {
  results: LookupResult[];
  /** Distinct records found across the results (the app opens the card when exactly one). */
  records: number;
}

export interface CardRef { type: string; id: string; label: string; ref: string | null; route: string }

export interface CardActivityItem extends CardRef {
  status: string | null;
  /** YYYY-MM-DD or ISO time. */
  date: string | null;
}

export interface LastSeen { at: string; byName: string | null; source: LookupLogSource }

/** The tag card (spec §4.3): what a found record is and what this person may do with it. */
export interface TagCard {
  recordType: string;
  typeLabel: string;
  recordId: string;
  /** The record's web route, for example `/assets/<id>`. */
  route: string;
  title: string;
  ref: string | null;
  /** The primary active tag value, and every active value. */
  tagValue: string | null;
  tagValues: string[];
  status: { value: string; label: string; color: string | null } | null;
  /** The image attachment marked as the record's photo (E37-06). */
  photo: { attachmentId: string; url: string; description: string | null } | null;
  site: CardRef | null;
  location: string | null;
  /** Owner, assignee or custodian, as the taggable type names them. */
  people: { field: string; label: string; userId: string; name: string }[];
  /** A few type-specific facts (TaggableDef.facts), as display text. */
  facts: { field: string; label: string; value: string | null }[];
  activity: {
    openTickets: CardActivityItem[];
    lastInspection: CardActivityItem | null;
    lastCondition: CardActivityItem | null;
    recentChanges: { at: string; summary: string; byName: string | null }[];
  };
  /** Legal holds on the record (references only): actions that would change it are left out. */
  holds: { ref: string }[];
  restricted: boolean;
  lastSeen: LastSeen | null;
  /** The record's ETag, sent as If-Match by quick updates. */
  version: string;
  actions: TagAction[];
}

export type TagActionKey =
  | 'report_problem' | 'report_hazard' | 'edit' | 'quick_update' | 'add_photo' | 'add_note'
  | 'record_condition' | 'start_inspection' | 'count' | 'replace_tag' | 'attach' | 'open';

/** A field quick updates may change, with its current value. */
export interface QuickField {
  field: string;
  label: string;
  type: 'lookup' | 'user' | 'ref' | 'text';
  list?: string;
  to?: string;
  value: unknown;
  display: string | null;
}

/**
 * One thing the person may do, computed on the server (permissions, switched-on areas, lifecycle,
 * holds). The client never decides what is allowed; it only draws the list, in order.
 */
export interface TagAction {
  key: TagActionKey;
  label: string;
  /** Where the web application goes for it (a route with query), when it is a page. */
  webPath: string | null;
  /**
   * A new record this action creates, prefilled (report a problem: a ticket with the record as the
   * affected asset, system or site; report a hazard; record condition). The app posts it to `path`.
   */
  prefill: {
    type: string; path: string; values: Record<string, unknown>;
    /** A record to link the new one to after creating it (`POST /api/links`), when no field holds it (a ticket about a site or vehicle). */
    link?: { type: string; id: string } | null;
  } | null;
  /** For quick_update: the fields and their values; PATCH the record's path with If-Match: version. */
  fields?: QuickField[];
  /** For count: the open count it counts towards. */
  countId?: string;
  /** For attach (from a lookup result): the value to attach. */
  value?: string;
}

// ---------- inventory counts (TAGS-COUNTS) ----------

/**
 * Record type `inventory_count` (permission module `tags`; reading needs tags.view, starting,
 * counting and finishing need tags.count), path `/api/inventory-counts`, route `/inventory-counts`,
 * reference `CNT-00001`. Fields: title, site_id (ref site), area, record_types (json), status
 * (inventory_count_status: open, finished, canceled; read-only), started_at, started_by, finished_at,
 * finished_by, summary (json, read-only), notes. Creating it fixes the expected list.
 */
export type CountItemState = 'pending' | 'found' | 'missing';

export interface CountItemView {
  id: string;
  recordType: string;
  recordId: string;
  label: string;
  ref: string | null;
  route: string;
  tagValue: string | null;
  expected: boolean;
  state: CountItemState;
  foundAt: string | null;
  foundByName: string | null;
  resolution: 'moved' | 'marked_missing' | 'left' | null;
}

/** `GET /api/inventory-counts/:id/items?state=&expected=` (tags.view). */
export interface CountItems { rows: CountItemView[]; totals: { expected: number; found: number; unexpected: number; pending: number; missing: number } }

/**
 * `POST /api/inventory-counts/:id/found` (tags.count) { value, source } or { recordType, recordId }.
 * Finding twice is harmless (`already_found`); several people may count at once.
 */
export interface CountFoundRequest { value?: string; source?: TagSource; recordType?: string; recordId?: string; clientId?: string }
export interface CountFoundResult {
  outcome: 'found' | 'already_found' | 'unexpected' | 'not_found';
  item: CountItemView | null;
  message: string;
}

/** `POST /api/inventory-counts/:id/finish` (tags.count) → the count's summary and what needs a decision. */
export interface CountFinishResult { summary: { expected: number; found: number; unexpected: number; missing: number }; missing: CountItemView[]; unexpected: CountItemView[] }

/** `POST /api/inventory-counts/:id/resolve` (tags.count): { itemIds, resolution } after finishing. */
export interface CountResolveRequest { itemIds: string[]; resolution: 'moved' | 'marked_missing' | 'left' }

// ---------- printing (TAGS-PRINT) ----------

export type LabelCode = 'none' | 'code128' | 'qr' | 'datamatrix';

export interface LabelLayout {
  /** A preset key (print-layouts.ts) or a saved layout's id. */
  id: string;
  name: string;
  kind: 'sheet' | 'roll';
  pageWidthMm: number; pageHeightMm: number;
  labelWidthMm: number; labelHeightMm: number;
  columns: number; rows: number;
  marginTopMm: number; marginLeftMm: number;
  gapXMm: number; gapYMm: number;
  preset: boolean;
}

/** `GET /api/asset-tags/print/layouts` (tags.manage) → LabelLayout[]; `POST`/`DELETE /:id` saved layouts. */
export interface PrintRequest {
  /** New values from a series, or existing values (typed list, or the tags of records). */
  from: { kind: 'series'; seriesId: string; count: number } | { kind: 'values'; values: string[] } | { kind: 'records'; recordType: string; recordIds: string[] };
  layoutId: string;
  /** Sheets: the first label position to use (1-based) on a partly used sheet. */
  startAt?: number;
  /** Defaults to `code128` (text and code). */
  code?: LabelCode;
  /** ZPL only: the label printer's resolution in dots per inch (default 203). */
  dpi?: 203 | 300 | 600;
  /** Text above the value, for example the organization's name. */
  topLine?: string | null;
  logo?: boolean;
  textHeightMm?: number;
  output: 'pdf' | 'zpl';
  /** An alignment test page instead of labels. */
  test?: boolean;
}
/** `POST /api/asset-tags/print` (tags.manage) → application/pdf or text/plain (ZPL); audit-logged; at most tags.print_limit labels. */
export type PrintResponse = Blob;

export type { TagFormat, TagSource };
