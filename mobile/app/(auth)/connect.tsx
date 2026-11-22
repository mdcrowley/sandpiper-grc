// Connect: the server address, the version check (GET /api/mobile/hello) and "Sign in" (E38-03).
// Owner: APP-CORE. Text: src/text/connect.ts.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useAuthState } from '../../src/api/client';
import { connect, ConnectError, signIn } from '../../src/auth/session';
import { connectText as T } from '../../src/text/connect';
import { Banner, Body, Button, Field, Screen, Title } from '../../src/ui';

export default function ConnectScreen() {
  const auth = useAuthState();
  const [address, setAddress] = useState(auth.server ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!auth.hello);

  useEffect(() => {
    if (auth.server && !address) setAddress(auth.server);
  }, [auth.server]); // eslint-disable-line react-hooks/exhaustive-deps

  async function check() {
    setBusy(true);
    setProblem(null);
    setMessage(null);
    try {
      await connect(address);
      setEditing(false);
    } catch (e) {
      setProblem(e instanceof ConnectError ? T.problems[e.problem] : T.problems.unreachable);
    } finally {
      setBusy(false);
    }
  }

  async function startSignIn() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await signIn();
      if (!r.ok) setMessage(r.reason === 'canceled' ? T.canceled : r.reason === 'refused' ? T.refused(r.message) : T.failed);
    } finally {
      setBusy(false);
    }
  }

  const reason = auth.signedOutReason ? T.signedOut[auth.signedOutReason] : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <Title>{T.title}</Title>
        {reason ? <Banner kind="warning">{reason}</Banner> : null}
        {editing || !auth.hello ? (
          <>
            <Body muted>{T.intro}</Body>
            <Field
              label={T.addressLabel}
              hint={T.addressHint}
              placeholder={T.addressPlaceholder}
              value={address}
              onChangeText={setAddress}
              error={problem}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={check}
              testID="server-address"
            />
            <Button label={busy ? T.checking : T.check} busy={busy} onPress={check} />
          </>
        ) : (
          <>
            <Body>{T.connectedTo(auth.hello.appName, auth.server ?? '')}</Body>
            {auth.updateSuggested ? <Banner kind="info">{T.updateSuggested}</Banner> : null}
            {message ? <Banner kind="error">{message}</Banner> : null}
            <Button label={T.signIn} busy={busy} onPress={startSignIn} accessibilityHint={T.signInHint} />
            <Button label={T.changeServer} kind="secondary" disabled={busy} onPress={() => setEditing(true)} />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
