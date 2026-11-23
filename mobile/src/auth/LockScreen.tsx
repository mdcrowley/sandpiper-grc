// Covers the app while the unlock is asked (spec §5.2 step 4). Shown by app/_layout.tsx.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { unlockText as T } from '../text/unlock';
import { useTheme } from '../theme';
import { Banner, Body, Button, Title, useFocusOn, type TextRef } from '../ui';
import { signOut, unlock } from './session';

export function LockScreen() {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useFocusOn<TextRef>('locked'); // the screen reader starts on the cover's title

  async function ask() {
    setBusy(true);
    try {
      setFailed(!(await unlock(T.prompt)));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void ask();
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.box, { backgroundColor: colors.bg }]} accessibilityViewIsModal>
      <Title ref={titleRef}>{T.title}</Title>
      <Body muted style={{ textAlign: 'center' }}>{T.body}</Body>
      {failed ? <Banner kind="error">{T.failed}</Banner> : null}
      <Button label={T.unlock} busy={busy} onPress={ask} />
      <Button label={T.signOut} kind="secondary" disabled={busy} onPress={() => void signOut()} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 24, gap: 16, justifyContent: 'center' },
});
