// The record view's Activity, Comments and Files (E38-07). Owner: APP-WORK.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { space } from '../theme';
import { addComment, errorText, fetchAttachments, fetchComments, fetchHistory } from './api';
import { fileSize, formatDateTime } from './format';
import { useLoad } from './hooks';
import { Body, Button, Card, Loading, Notice, TextField } from './ui';

export const PANEL_TEXT = {
  loadingActivity: 'Loading activity',
  noActivity: 'No activity yet.',
  loadingComments: 'Loading comments',
  noComments: 'No comments yet.',
  internal: 'Internal',
  newComment: 'Add a comment',
  commentHint: 'Watchers are told about it',
  addComment: 'Add comment',
  added: 'Comment added.',
  loadingFiles: 'Loading files',
  noFiles: 'No files.',
  evidence: 'Evidence',
  filesOnWeb: 'Open or add files on the web',
  someone: 'Someone',
};

export function ActivityPanel({ type, id }: { type: string; id: string }) {
  const { data, error, loading } = useLoad(() => fetchHistory(type, id), [type, id]);
  if (loading && !data) return <Loading label={PANEL_TEXT.loadingActivity} />;
  return (
    <View style={styles.list}>
      {error ? <Notice>{error}</Notice> : null}
      {data && data.length === 0 ? <Body muted>{PANEL_TEXT.noActivity}</Body> : null}
      {(data ?? []).slice(0, 50).map((e) => (
        <View key={e.id} accessible accessibilityLabel={`${formatDateTime(e.at)}, ${e.actor_name ?? PANEL_TEXT.someone}: ${e.summary}`} style={styles.item}>
          <Body muted>{`${formatDateTime(e.at)} · ${e.actor_name ?? PANEL_TEXT.someone}`}</Body>
          <Body>{e.summary}</Body>
        </View>
      ))}
    </View>
  );
}

export function CommentsPanel({ type, id }: { type: string; id: string }) {
  const comments = useLoad(() => fetchComments(type, id), [type, id]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const row = await addComment(type, id, body);
      comments.setData([...(comments.data ?? []), row]);
      setBody('');
      setDone(true);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.list}>
      {comments.loading && !comments.data ? <Loading label={PANEL_TEXT.loadingComments} /> : null}
      {comments.error ? <Notice>{comments.error}</Notice> : null}
      {comments.data && comments.data.length === 0 ? <Body muted>{PANEL_TEXT.noComments}</Body> : null}
      {(comments.data ?? []).map((c) => (
        <Card key={c.id}>
          <Body muted>{[c.author_name ?? PANEL_TEXT.someone, formatDateTime(c.created_at), c.internal ? PANEL_TEXT.internal : null].filter(Boolean).join(' · ')}</Body>
          <Body selectable>{c.body}</Body>
        </Card>
      ))}
      <TextField label={PANEL_TEXT.newComment} hint={PANEL_TEXT.commentHint} value={body} onChangeText={(t) => { setBody(t); setDone(false); }} multiline error={problem} />
      <Button kind="primary" label={PANEL_TEXT.addComment} onPress={() => void send()} busy={busy} disabled={!body.trim()} />
      {done ? <Notice kind="success">{PANEL_TEXT.added}</Notice> : null}
    </View>
  );
}

export function FilesPanel({ type, id, onOpenWeb }: { type: string; id: string; onOpenWeb: () => void }) {
  const { data, error, loading } = useLoad(() => fetchAttachments(type, id), [type, id]);
  return (
    <View style={styles.list}>
      {loading && !data ? <Loading label={PANEL_TEXT.loadingFiles} /> : null}
      {error ? <Notice>{error}</Notice> : null}
      {data && data.length === 0 ? <Body muted>{PANEL_TEXT.noFiles}</Body> : null}
      {(data ?? []).map((f) => (
        <View key={f.id} accessible accessibilityLabel={`${f.file_name}, ${fileSize(f.size_bytes)}`} style={styles.item}>
          <Body>{f.file_name}</Body>
          <Body muted>{[fileSize(f.size_bytes), f.kind === 'evidence' ? PANEL_TEXT.evidence : null, f.uploaded_by_name, formatDateTime(f.uploaded_at)].filter(Boolean).join(' · ')}</Body>
          {f.description ? <Body muted>{f.description}</Body> : null}
        </View>
      ))}
      <Button label={PANEL_TEXT.filesOnWeb} onPress={onOpenWeb} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space[3] },
  item: { gap: 2 },
});
