// One approval to decide (E38-08): /approvals/step/<step id>. Owner: APP-WORK.
import { Stack, useLocalSearchParams } from 'expo-router';
import { headerOptions } from '../../../src/records/header';
import { useTheme } from '../../../src/theme';
import ApprovalScreen from '../../../src/records/screens/ApprovalScreen';

export default function ApprovalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  return (
    <>
      <Stack.Screen options={{ ...headerOptions(colors), headerShown: true, title: 'Approval' }} />
      <ApprovalScreen key={String(id)} stepId={String(id)} />
    </>
  );
}
