// Covers the app while the unlock is asked (spec §5.2 step 4). Shown by app/_layout.tsx.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { unlockText as T } from '../text/unlock';
import { useTheme } from '../theme';
import { Banner, Body, Button, Title } from '../ui';
import { signOut, unlock } from './session';

export function LockScreen() {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

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
      <Title>{T.title}</Title>
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
