// Tags and watching on any record (server: core/tags.ts).
//   RecordTags   - the tags of one record, editable by anyone who may edit it (RecordPage header)
//   TagChips     - a row of tags, read-only (list cells)
//   TagsFilter   - "has any of these tags" in a ResourceList's Filters popover (f.tags=a,b)
//   WatchButton  - Watch / Watching toggle (RecordPage header)
import { useEffect, useState } from 'react';
import { Button, TagsInput, Tooltip } from '@mantine/core';
import { api, errorMessage } from './api';
import { useDebounced, useFetch } from './hooks';
import { Icon } from './Icon';
import { useToast } from './overlay';
import { usePopupHost } from './popups';

const query = (type: string, id: string) => `record_type=${encodeURIComponent(type)}&record_id=${encodeURIComponent(id)}`;

/** Suggestions for a record type: existing tags on records the person may see, most used first. */
function useTagOptions(type: string, typed: string): string[] {
  const q = useDebounced(typed, 200);
  const { data } = useFetch<{ tag: string; count: number }[]>(`/api/tags/options?record_type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}`);
  return (data ?? []).map((t) => t.tag);
}

/** Tags as small chips. Nothing at all when there are none. */
export function TagChips({ tags, max = 4 }: { tags?: string[] | null; max?: number }) {
  if (!tags || tags.length === 0) return null;
  const shown = tags.slice(0, max);
  return (
    <span className="tag-chips">
      {shown.map((t) => <span key={t} className="tag-chip">{t}</span>)}
      {tags.length > shown.length && <span className="tag-chip tag-chip-more" title={tags.slice(max).join(', ')}>+{tags.length - shown.length}</span>}
    </span>
  );
}

export interface RecordTagsProps {
  recordType: string;
  recordId: string;
  /** Whether the person may change the tags (edit permission on the record). */
  canEdit?: boolean;
}

/** The tags of one record: chips, and for editors a box to add and remove them. */
export function RecordTags({ recordType, recordId, canEdit }: RecordTagsProps) {
  const toast = useToast();
  const host = usePopupHost();
  const { data, error, reload } = useFetch<{ tags: string[] }>(`/api/tags?${query(recordType, recordId)}`);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useTagOptions(recordType, editing ? typed : '');
  const tags = data?.tags ?? [];
  useEffect(() => { if (!editing) setDraft(tags); }, [editing, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tags are a nicety: when the server has no tags service, show nothing rather than an error.
  if (error) return null;
  if (!data) return null;
  if (!editing && tags.length === 0 && !canEdit) return null;

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/api/tags', { record_type: recordType, record_id: recordId, tags: draft });
      setEditing(false);
      reload();
      window.dispatchEvent(new CustomEvent('grc:record-changed', { detail: { recordType, recordId } }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="record-tags record-tags-editing">
        <TagsInput
          ref={host.ref}
          comboboxProps={host.popup}
          aria-label="Tags"
          size="xs"
          className="record-tags-input"
          placeholder={draft.length ? '' : 'Type a tag and press Enter'}
          data={options}
          value={draft}
          onChange={(v) => setDraft(v.map((t) => t.trim().toLowerCase()).filter(Boolean))}
          searchValue={typed}
          onSearchChange={setTyped}
          maxTags={30}
          clearable
          autoFocus
          splitChars={[',', ' ']}
        />
        <Button size="compact-sm" loading={busy} onClick={() => void save()}>Save tags</Button>
        <Button size="compact-sm" variant="default" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="record-tags" aria-label="Tags">
      <Icon name="tag" size={15} className="record-tags-icon" />
      {tags.length ? <TagChips tags={tags} max={12} /> : <span className="muted record-tags-none">No tags</span>}
      {canEdit && (
        <Button size="compact-xs" variant="subtle" onClick={() => setEditing(true)} aria-label={tags.length ? 'Edit tags' : 'Add tags'}>
          {tags.length ? 'Edit' : 'Add tags'}
        </Button>
      )}
    </div>
  );
}

/** The tags filter in a list's Filters popover: rows with any of the chosen tags. */
export function TagsFilter({ recordType, value, onChange }: { recordType: string; value: string[]; onChange: (tags: string[]) => void }) {
  const [typed, setTyped] = useState('');
  const options = useTagOptions(recordType, typed);
  return (
    <TagsInput
      label="Tags"
      description="Records with any of these tags"
      placeholder={value.length ? '' : 'Any tag'}
      size="sm"
      data={options}
      value={value}
      onChange={(v) => onChange(v.map((t) => t.trim().toLowerCase()).filter(Boolean))}
      searchValue={typed}
      onSearchChange={setTyped}
      clearable
    />
  );
}

interface WatchState { watching: boolean; count: number; watchers: { id: string; label: string }[] }

/** Watch a record to be told when its status changes or someone comments. */
export function WatchButton({ recordType, recordId }: { recordType: string; recordId: string }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<WatchState>(`/api/watchers?${query(recordType, recordId)}`);
  const [busy, setBusy] = useState(false);
  if (error || !data) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      if (data.watching) await api.del(`/api/watchers?${query(recordType, recordId)}`);
      else await api.post('/api/watchers', { record_type: recordType, record_id: recordId });
      reload();
      toast.success(data.watching ? 'You will no longer be told about changes.' : 'You will be told when its status changes or someone comments.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const others = data.watchers.map((w) => w.label);
  const tip = data.count === 0 ? 'Nobody is watching this yet' : `Watching: ${others.join(', ')}`;
  return (
    <Tooltip label={tip} multiline maw={280}>
      <Button
        variant={data.watching ? 'light' : 'default'}
        leftSection={<Icon name="eye" size={16} />}
        loading={busy}
        aria-pressed={data.watching}
        onClick={() => void toggle()}
      >
        {data.watching ? 'Watching' : 'Watch'}
        {data.count > 0 && <span className="rc-count" aria-label={`${data.count} watching`}>{data.count}</span>}
      </Button>
    </Tooltip>
  );
}
