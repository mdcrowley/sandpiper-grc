// A policy to read and acknowledge (E38-08): /approvals/acknowledgment/<request id>. Owner: APP-WORK.
import { Stack, useLocalSearchParams } from 'expo-router';
import { headerOptions } from '../../../src/records/header';
import { useTheme } from '../../../src/theme';
import AcknowledgmentScreen from '../../../src/records/screens/AcknowledgmentScreen';

export default function AcknowledgmentRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  return (
    <>
      <Stack.Screen options={{ ...headerOptions(colors), headerShown: true, title: 'Policy' }} />
      <AcknowledgmentScreen key={String(id)} ackId={String(id)} />
    </>
  );
}
