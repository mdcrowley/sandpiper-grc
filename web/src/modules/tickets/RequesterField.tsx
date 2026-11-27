// E18-84: the requester is found, not typed. A search over the accounts and (for people who may see
// it) the staff roster, which fills the name, department and email, and links the account. A name
// that is not found stays as typed: an outside requester.
import { useEffect, useMemo, useState } from 'react';
import { Autocomplete } from '@mantine/core';
import { api, useDebounced } from '../../core';
import { fieldShell } from '../../core/fieldShell';

export interface RequesterOption {
  kind: 'user' | 'person';
  id: string;
  name: string;
  email: string | null;
  department: string | null;
  number: string | null;
  user_id: string | null;
}

/** The line shown for an option; also its key, so it must be unique. */
const lineOf = (o: RequesterOption) => [
  o.name,
  o.email ?? (o.number ? `no. ${o.number}` : null),
  o.department,
  o.kind === 'person' && !o.user_id ? 'roster, no account' : null,
].filter(Boolean).join(' · ');

export function RequesterField({ value, onType, onPick, error, hint }: {
  value: string;
  /** Typed by hand: the name only; the account link, if any, is dropped. */
  onType: (name: string) => void;
  onPick: (o: RequesterOption) => void;
  error?: string;
  hint?: string;
}) {
  const [options, setOptions] = useState<RequesterOption[]>([]);
  const q = useDebounced(value.trim(), 250);
  useEffect(() => {
    let live = true;
    if (q.length < 2) { setOptions([]); return; }
    api.get<{ rows: RequesterOption[] }>(`/api/tickets/requesters?q=${encodeURIComponent(q)}`)
      .then((r) => { if (live) setOptions(r.rows); })
      .catch(() => { if (live) setOptions([]); });
    return () => { live = false; };
  }, [q]);
  const byLine = useMemo(() => new Map(options.map((o) => [lineOf(o), o])), [options]);
  return (
    <Autocomplete
      {...fieldShell({ label: 'Requester', error, hint })}
      value={value}
      data={[...byLine.keys()]}
      // The server has already matched the words typed; show what it found as it is.
      filter={({ options: all }) => all}
      onChange={(v) => {
        const picked = byLine.get(v);
        if (picked) onPick(picked); else onType(v);
      }}
      autoComplete="off"
    />
  );
}
