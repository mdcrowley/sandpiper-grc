// Shapes of the outside reviewer API (server/src/modules/outsidereviews, E41-09).

export type GrantState = 'active' | 'expired' | 'revoked';

export interface Grant {
  id: string; subject_type: string; subject_id: string; user_id: string;
  name: string; email: string; username: string; organization: string | null;
  expires_on: string; note: string | null; state: GrantState;
  waiting_for_setup: boolean; account_disabled: boolean;
  invited_by_name: string | null; invited_at: string; revoked_at: string | null; last_opened_at: string | null; updated_at: string;
}

export interface ReviewFile {
  id: string; file_name: string; size_bytes: number; extension: string | null; is_link: boolean;
  link_url: string | null; link_title: string | null; description: string | null; uploaded_at: string; scanned: boolean;
}

export interface Workspace {
  grant: { id: string; expires_on: string; days_left: number };
  today: string;
  subject: {
    type: string; kind: string; ref: string | null; title: string;
    facts: { label: string; value: string | null }[];
    sections: { label: string; text: string }[];
  };
  requests: {
    id: string; ref: string | null; request: string; area: string | null; due_on: string | null; status: string;
    status_label: string; response_note: string | null; answered_at: string | null; asked_of: string | null; files: ReviewFile[];
  }[];
  findings: {
    id: string; ref: string | null; title: string; area: string | null; rating: string | null; status_label: string;
    due_on: string | null; parts: { label: string; text: string }[];
  }[];
  files: ReviewFile[];
  labels: { requests: string; findings: string };
}

export interface MyReviews {
  reviewer: boolean;
  today: string;
  reviews: { id: string; kind: string; state: GrantState; expires_on: string; ref: string | null; title: string | null; days_left: number | null }[];
}

export const STATE_LABEL: Record<GrantState, string> = { active: 'Open', expired: 'Ended', revoked: 'Revoked' };
export const STATE_COLOR: Record<GrantState, 'green' | 'gray' | 'red'> = { active: 'green', expired: 'gray', revoked: 'red' };

/** "2.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
