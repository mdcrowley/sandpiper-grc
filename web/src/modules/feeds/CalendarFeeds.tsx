// /account/calendar-feeds: a person's own calendar feeds (E36-03). Each feed has a secret address to
// subscribe to from a calendar program; it is shown once, when the feed is made or its address is
// replaced. The kinds of date offered are those the person may use now (core/calendar.ts on the server).
import { useState, type FormEvent } from 'react';
import {
  api, ApiError, Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, Loading, Modal,
  PageHeader, relativeTime, Select, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { CopyBox } from '../admin/common';
import './feeds.css';

interface Source { key: string; label: string }
interface Feed { id: string; name: string; sources: string[]; detail: 'titles' | 'busy'; created_at: string; last_used_at: string | null }
interface Mine { enabled: boolean; sources: Source[]; feeds: Feed[]; maxFeeds: number; window: { daysBack: number; daysAhead: number } }
interface Made extends Feed { address: string }

const DETAIL_OPTIONS = [
  { value: 'titles', label: 'Titles: what each date is about' },
  { value: 'busy', label: 'Busy only: the kind of date, no titles' },
];

export function CalendarFeedsPage() {
  const auth = useAuth();
  const toast = useToast();
  const mine = useFetch<Mine>('/api/me/calendar-feeds');
  const [editing, setEditing] = useState<Feed | 'new' | null>(null);
  const [shown, setShown] = useState<Made | null>(null);
  const [rotating, setRotating] = useState<Feed | null>(null);
  const [revoking, setRevoking] = useState<Feed | null>(null);
  const [busy, setBusy] = useState(false);
  const labelOf = (key: string) => mine.data?.sources.find((s) => s.key === key)?.label;

  const rotate = async () => {
    if (!rotating) return;
    setBusy(true);
    try {
      setShown(await api.post<Made>(`/api/me/calendar-feeds/${rotating.id}/rotate`));
      toast.success('New address made. The old one has stopped working.');
      mine.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRotating(null);
    }
  };

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.del(`/api/me/calendar-feeds/${revoking.id}`);
      toast.success('Feed revoked.');
      if (shown?.id === revoking.id) setShown(null);
      mine.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  };

  const data = mine.data;
  return (
    <div className="feeds-page">
      <PageHeader
        title="Calendar feeds"
        subtitle={auth.user ? `Your due dates, reviews, meetings and changes in your own calendar program` : undefined}
        breadcrumbs={[{ label: 'Account security', to: '/account/security' }]}
        actions={data?.enabled && data.sources.length > 0 && data.feeds.length < data.maxFeeds
          ? <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>New feed</Button> : undefined}
      />
      {mine.error ? (
        <ErrorState title="Your calendar feeds could not be loaded" error={mine.error} onRetry={mine.reload} />
      ) : !data ? (
        <Loading label="Loading calendar feeds" lines={3} />
      ) : (
        <>
          {!data.enabled && (
            <Card>
              <p className="feeds-notice">
                Calendar feeds are switched off. An administrator can switch them on; until then no feed address answers.
              </p>
            </Card>
          )}
          {shown && (
            <Card title="Your feed's address">
              <CopyBox prominent label={`Address of "${shown.name}"`} copyLabel="Copy address" value={shown.address} testId="feed-address">
                <p className="muted feeds-copy-hint">
                  Copy it now: it is shown only this once. In your calendar program choose to add a calendar from an address
                  (it may be called "subscribe" or "from internet") and paste it. Anyone with the address sees what the feed shows,
                  so keep it to yourself; if it gets out, make a new address or revoke the feed.
                </p>
              </CopyBox>
              <div className="form-actions"><Button onClick={() => setShown(null)}>Done</Button></div>
            </Card>
          )}
          <Card title="Your feeds">
            <p className="muted">
              A feed shows dates from {data.window.daysBack} days ago to {data.window.daysAhead} days ahead, only for records you may see now and
              are involved in. Restricted records show as "Restricted record" unless the feed shows titles. Calendar programs usually
              look again every few hours.
            </p>
            {data.feeds.length === 0 ? (
              <EmptyState
                icon="calendar" title="No calendar feeds"
                message={data.enabled
                  ? (data.sources.length ? 'Make a feed, then add its address to your calendar program.' : 'There are no kinds of date you can put in a feed.')
                  : 'Calendar feeds are switched off.'}
              />
            ) : (
              <ul className="feeds-list" aria-label="Your calendar feeds">
                {data.feeds.map((f) => (
                  <li key={f.id} className="feeds-item">
                    <div className="feeds-main">
                      <strong>{f.name}</strong>
                      <span className="feeds-kinds">
                        {f.sources.map((k) => labelOf(k)).filter(Boolean).join(', ') || 'Nothing you can see at the moment'}
                      </span>
                      <span className="muted">
                        Made {formatDate(f.created_at)} · {f.last_used_at ? `last read ${relativeTime(f.last_used_at)}` : 'not read yet'}
                      </span>
                    </div>
                    <Badge color={f.detail === 'titles' ? 'blue' : 'gray'}>{f.detail === 'titles' ? 'Titles' : 'Busy only'}</Badge>
                    <div className="feeds-actions">
                      <Button size="sm" onClick={() => setEditing(f)}>Edit</Button>
                      {data.enabled && <Button size="sm" onClick={() => setRotating(f)}>New address</Button>}
                      <Button size="sm" variant="danger" onClick={() => setRevoking(f)}>Revoke</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
      {editing && data && (
        <FeedDialog
          feed={editing === 'new' ? null : editing} sources={data.sources}
          onClose={() => setEditing(null)}
          onSaved={(made) => { setEditing(null); if (made) setShown(made); mine.reload(); }}
        />
      )}
      <ConfirmDialog
        open={rotating !== null} busy={busy} title="Make a new address?" confirmLabel="Make new address"
        message={`The current address of "${rotating?.name}" stops working at once. You will need to add the new one to your calendar program.`}
        onConfirm={() => void rotate()} onCancel={() => setRotating(null)}
      />
      <ConfirmDialog
        open={revoking !== null} busy={busy} danger title="Revoke this feed?" confirmLabel="Revoke feed"
        message={`"${revoking?.name}" stops working at once, wherever it was added. This cannot be undone.`}
        onConfirm={() => void revoke()} onCancel={() => setRevoking(null)}
      />
    </div>
  );
}

function FeedDialog({ feed, sources, onClose, onSaved }: { feed: Feed | null; sources: Source[]; onClose: () => void; onSaved: (made: Made | null) => void }) {
  const toast = useToast();
  const start = { name: feed?.name ?? '', chosen: feed?.sources ?? sources.map((s) => s.key), detail: feed?.detail ?? 'titles' };
  const [name, setName] = useState(start.name);
  const [chosen, setChosen] = useState<string[]>(start.chosen);
  const [detail, setDetail] = useState<string>(start.detail);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = name !== start.name || detail !== start.detail || chosen.slice().sort().join() !== start.chosen.slice().sort().join();
  const toggle = (key: string, on: boolean) => setChosen((c) => (on ? [...c, key] : c.filter((k) => k !== key)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const body = { name, sources: chosen, detail };
      if (feed) {
        await api.patch(`/api/me/calendar-feeds/${feed.id}`, body);
        toast.success('Feed changed. Its address stays the same.');
        onSaved(null);
      } else {
        onSaved(await api.post<Made>('/api/me/calendar-feeds', body));
      }
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={feed ? `Edit "${feed.name}"` : 'New calendar feed'} onClose={onClose} dirty={dirty}>
      <form className="form" onSubmit={submit}>
        <TextField label="Name" required maxLength={100} value={name} onChange={setName} error={errors.name} hint='For example "Work calendar".' />
        <fieldset className="feeds-kinds-field">
          <legend className="field-label">Kinds of date</legend>
          {sources.map((s) => (
            <Checkbox key={s.key} label={s.label} checked={chosen.includes(s.key)} onChange={(on) => toggle(s.key, on)} />
          ))}
          {errors.sources && <p className="field-error" role="alert">{errors.sources}</p>}
        </fieldset>
        <Select
          label="What each date shows" value={detail} onChange={(v) => setDetail(v ?? 'titles')} options={DETAIL_OPTIONS} error={errors.detail}
          hint="Busy only suits a calendar other people can see: it says what kind of date it is, never what it is about."
        />
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{feed ? 'Save changes' : 'Make feed'}</Button>
        </div>
      </form>
    </Modal>
  );
}
