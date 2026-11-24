// API shapes of My work's due items and the compliance calendar (E41-03), shared by the server
// (server/src/modules/work), the web application (web/src/modules/work) and the mobile app.
// Every item comes from a calendar source (server/src/core/calendar.ts): one registration per kind.

/** One dated item: something due (or a date to know about) on a record. */
export interface DueItem {
  /** Unique across sources. */
  uid: string;
  /** The calendar source, for example `audits.requests`. */
  source: string;
  /** The kind of item, for example "Evidence requests". */
  kind: string;
  /** The feature area it belongs to (its key and name), for filters. */
  area: string;
  areaLabel: string;
  title: string;
  /** A date (`YYYY-MM-DD`, with `allDay`) or an ISO date and time. */
  start: string;
  end: string | null;
  allDay: boolean;
  /** The record's page in the web application. */
  url: string;
  recordType: string;
  recordId: string;
  ref: string | null;
  /** Who it is for, when one person is. */
  personId: string | null;
  personName: string | null;
  /** Work past its date that is not done yet. */
  overdue: boolean;
  /** Work to do (shown in My work), rather than a date to know about. */
  work: boolean;
  /** A restricted record (only people who may see restricted records get it at all). */
  restricted: boolean;
}

/** One kind of due work in My work. */
export interface DueSection {
  /** The calendar source, for example `audits.requests`. */
  key: string;
  kind: string;
  area: string;
  areaLabel: string;
  /** Everything waiting of this kind (overdue, and due within the window). */
  count: number;
  overdue: number;
  /** Most urgent first, at most `limit`. */
  items: DueItem[];
}

/** `GET /api/work/mine`: the signed-in person's own due work across every area that is on. */
export interface MyDueWork {
  sections: DueSection[];
  total: number;
  overdue: number;
  /** Items due up to this date (inclusive) are counted; overdue ones always are. */
  until: string;
  generatedAt: string;
}

/** `GET /api/work/calendar`: everything due between two dates that the person may see. */
export interface ComplianceCalendar {
  from: string;
  to: string;
  /** `me`, `all` or a user id. */
  person: string;
  items: DueItem[];
  /** The areas and kinds the person may filter by (only areas that are on and that they may see). */
  areas: { key: string; label: string }[];
  kinds: { key: string; kind: string; area: string; anyone: boolean }[];
  /** Kinds that show only the person's own items, so are left out when another person (or everyone) is chosen. */
  ownOnly: string[];
  truncated: boolean;
}
