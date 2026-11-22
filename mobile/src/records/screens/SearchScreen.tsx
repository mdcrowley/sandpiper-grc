// Search (E38-07, spec §5.3): across everything the person may see (GET /api/search, which leaves out
// what they may not), with the records opened recently while the box is empty. Owner: APP-WORK.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSession } from '../../api/client';
import { space, useTheme } from '../../theme';
import { errorText, search } from '../api';
import { useMeta } from '../hooks';
import { recordHref, searchTarget } from '../navigate';
import { clearRecent, loadRecent, type RecentItem } from '../recent';
import type { SearchHit } from '../types';
import { Body, Button, Heading, ListRow, Loading, Notice, TextField } from '../ui';
import { openOnWeb } from '../web';

export const TEXT = {
  box: 'Search for',
  boxHint: 'Names, references, comments and file names',
  placeholder: 'For example a reference or a name',
  searchButton: 'Search',
  tooShort: 'Type at least two characters.',
  searching: 'Searching',
  noResults: (q: string) => `Nothing found for “${q}”.`,
  results: (n: number) => (n === 1 ? '1 result' : `${n} results`),
  recent: 'Recent',
  noRecent: 'Records you open appear here.',
  clearRecent: 'Clear recent',
  inComment: 'Found in a comment',
  inFile: 'Found in a file name',
  opensWeb: 'Opens on the web',
};

const DEBOUNCE_MS = 350;

export default function SearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { session } = useSession();
  const { meta } = useMeta();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const ctrl = useRef<AbortController | null>(null);

  useFocusEffect(useCallback(() => { void loadRecent().then(setRecent); }, []));

  const run = useCallback(async (text: string) => {
    ctrl.current?.abort();
    const term = text.trim();
    if (term.length < 2) { setHits(null); setError(null); setBusy(false); return; }
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    try {
      const found = await search(term, c.signal);
      if (!c.signal.aborted) { setHits(found); setError(null); }
    } catch (err) {
      if (!c.signal.aborted) setError(errorText(err));
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void run(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, run]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const viewable = (type: string) => Boolean(meta?.resources[type]);
  const openHit = (hit: SearchHit) => {
    const target = searchTarget(hit, viewable);
    if ('app' in target) router.push(target.app as never);
    else void openOnWeb(session?.server, target.web);
  };

  const term = q.trim();
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField
        label={TEXT.box}
        hint={TEXT.boxHint}
        placeholder={TEXT.placeholder}
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => void run(q)}
        clearButtonMode="while-editing"
      />
      <Button label={TEXT.searchButton} kind="primary" onPress={() => void run(q)} disabled={term.length < 2} />
      {term.length === 1 ? <Body muted>{TEXT.tooShort}</Body> : null}
      {error ? <Notice>{error}</Notice> : null}
      {busy && !hits ? <Loading label={TEXT.searching} /> : null}

      {term.length >= 2 && hits ? (
        <View accessibilityLiveRegion="polite">
          <Body muted>{hits.length ? TEXT.results(hits.length) : TEXT.noResults(term)}</Body>
          {hits.map((hit) => (
            <ListRow
              key={`${hit.type}:${hit.id}`}
              title={hit.label}
              details={[
                [hit.typeLabel, hit.ref].filter(Boolean).join(' · '),
                hit.matched === 'comment' ? TEXT.inComment : hit.matched === 'attachment' ? TEXT.inFile : null,
                hit.snippet ?? null,
              ]}
              hint={viewable(hit.type) ? undefined : TEXT.opensWeb}
              onPress={() => openHit(hit)}
            />
          ))}
        </View>
      ) : null}

      {term.length < 2 ? (
        <View style={styles.recent}>
          <Heading level={2}>{TEXT.recent}</Heading>
          {recent.length === 0 ? <Body muted>{TEXT.noRecent}</Body> : null}
          {recent.map((r) => (
            <ListRow
              key={`${r.type}:${r.id}`}
              title={r.label}
              details={[[r.typeLabel, r.ref].filter(Boolean).join(' · ')]}
              onPress={() => router.push(recordHref(r.type, r.id) as never)}
            />
          ))}
          {recent.length ? <Button kind="link" label={TEXT.clearRecent} onPress={() => void clearRecent().then(() => setRecent([]))} /> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[3] },
  recent: { gap: space[2] },
});
