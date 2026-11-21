// Activity of one record: a comment composer and one timeline of comments and changes.
import { useState, type FormEvent } from 'react';
import { Avatar, Badge, Button, SegmentedControl, Text, Textarea } from '@mantine/core';
import { IconLock, IconMessage, IconWorld } from '@tabler/icons-react';
import { api, errorMessage, type Row } from './api';
import { useAuth } from './auth';
import { useFetch, type FetchState } from './hooks';
import { useToast } from './overlay';
import { HistoryEntry, recordQuery, useHistoryContext, When, type HistoryEvent, type PanelProps } from './RecordHistory';
import { EmptyState, ErrorState, Loading } from './ui';
import './records.css';

export interface RecordComment {
  id: string;
  body: string;
  internal: boolean;
  author_name: string | null;
  created_at: string;
}

export interface ActivityPanelProps extends PanelProps {
  /** Whether new comments start as internal notes (default true, the safer choice). */
  defaultInternal?: boolean;
  /** Hide the internal/public choice and make every comment internal. */
  internalOnly?: boolean;
  /** The record, when you have it (names for the ids in its history). */
  row?: Row;
  /** Comments already being loaded by the page (RecordPage shares its request). */
  commentsState?: FetchState<RecordComment[]>;
}

type Show = 'all' | 'comments' | 'changes';

/** Comments and record history merged into one timeline (newest first), with an add-comment box. */
export function ActivityPanel({ type, id, defaultInternal = true, internalOnly, row, commentsState }: ActivityPanelProps) {
  const toast = useToast();
  const { user } = useAuth();
  const own = useFetch<RecordComment[]>(commentsState ? null : `/api/comments${recordQuery(type, id)}`);
  const comments = commentsState ?? own;
  const history = useFetch<HistoryEvent[]>(`/api/history${recordQuery(type, id)}`);
  const ctx = useHistoryContext(type, history.data, row);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(defaultInternal);
  const [posting, setPosting] = useState(false);
  const [show, setShow] = useState<Show>('all');
  const asInternal = internalOnly || internal;

  const post = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      await api.post('/api/comments', { record_type: type, record_id: id, body: body.trim(), internal: asInternal });
      setBody('');
      comments.reload();
      history.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  // Adding a comment also writes a history event; the comment itself already tells that story.
  const events = (history.data ?? []).filter((h) => h.action !== 'comment.add');
  const items = [
    ...(show === 'changes' ? [] : comments.data ?? []).map((c) => ({ at: c.created_at, comment: c, event: undefined })),
    ...(show === 'comments' ? [] : events).map((h) => ({ at: h.at, comment: undefined, event: h })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="rc-activity">
      <form className="rc-compose" onSubmit={post}>
        <Avatar name={user?.displayName ?? '?'} color="initials" size={32} radius="xl" aria-hidden="true" className="rc-compose-avatar" />
        <div className="rc-compose-main" data-internal={asInternal || undefined}>
          <Textarea
            aria-label="Add a comment"
            placeholder={asInternal ? 'Write an internal note…' : 'Write a public comment…'}
            autosize
            minRows={2}
            maxRows={12}
            variant="unstyled"
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void post();
            }}
          />
          <div className="rc-compose-row">
            {internalOnly ? (
              <Text size="xs" c="dimmed" className="rc-compose-hint"><IconLock size={13} aria-hidden="true" /> Internal note: visible to staff only</Text>
            ) : (
              <div className="rc-compose-choice">
                <SegmentedControl
                  size="xs"
                  aria-label="Who can see this comment"
                  value={internal ? 'internal' : 'public'}
                  onChange={(v) => setInternal(v === 'internal')}
                  data={[
                    { value: 'internal', label: <span className="rc-seg"><IconLock size={13} aria-hidden="true" />Internal note</span> },
                    { value: 'public', label: <span className="rc-seg"><IconWorld size={13} aria-hidden="true" />Public comment</span> },
                  ]}
                />
                <Text size="xs" c="dimmed" className="rc-compose-hint">
                  {internal ? 'Visible to staff only.' : 'Visible to the requester as well as staff.'}
                </Text>
              </div>
            )}
            <Button type="submit" size="xs" loading={posting} disabled={!body.trim()} leftSection={<IconMessage size={14} aria-hidden="true" />}
              title="Ctrl+Enter">
              Add {asInternal ? 'note' : 'comment'}
            </Button>
          </div>
        </div>
      </form>

      <div className="rc-activity-bar">
        <SegmentedControl
          size="xs"
          aria-label="Show"
          value={show}
          onChange={(v) => setShow(v as Show)}
          data={[
            { value: 'all', label: 'Everything' },
            { value: 'comments', label: `Comments${comments.data ? ` (${comments.data.length})` : ''}` },
            { value: 'changes', label: 'Edits' },
          ]}
        />
      </div>

      {comments.error ? (
        <ErrorState title="Comments could not be loaded" error={comments.error} onRetry={comments.reload} />
      ) : !comments.data ? (
        <Loading label="Loading activity" />
      ) : items.length === 0 ? (
        <EmptyState icon="message" title={show === 'comments' ? 'No comments yet' : 'No activity yet'} message="Comments and changes will appear here." />
      ) : (
        <ol className="rc-timeline">
          {items.map(({ comment, event }) => comment ? (
            <li key={`c-${comment.id}`} className="rc-tl-item rc-tl-comment">
              <Avatar name={comment.author_name ?? '?'} color="initials" size={32} radius="xl" className="rc-tl-avatar" aria-hidden="true" />
              <div className="rc-tl-body rc-bubble" data-internal={comment.internal || undefined}>
                <p className="rc-tl-head">
                  <strong>{comment.author_name ?? 'Unknown user'}</strong>
                  <Badge size="sm" variant="light" color={comment.internal ? 'yellow' : 'blue'}
                    leftSection={comment.internal ? <IconLock size={11} aria-hidden="true" /> : <IconWorld size={11} aria-hidden="true" />}>
                    {comment.internal ? 'Internal note' : 'Public comment'}
                  </Badge>
                  <span className="rc-tl-sep" aria-hidden="true">·</span>
                  <When at={comment.created_at} />
                </p>
                <p className="rc-prose rc-comment-body">{comment.body}</p>
              </div>
            </li>
          ) : event ? (
            <HistoryEntry key={`h-${event.id}`} event={event} ctx={ctx} />
          ) : null)}
        </ol>
      )}
    </div>
  );
}
