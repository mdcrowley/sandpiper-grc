// Approvals waiting for me and policy acknowledgments due (E38-08): /approvals[?show=acknowledgments].
// Owner: APP-WORK. The screen is in src/records.
import { Stack, useLocalSearchParams } from 'expo-router';
import { headerOptions } from '../../src/records/header';
import { useTheme } from '../../src/theme';
import ApprovalsScreen, { TEXT } from '../../src/records/screens/ApprovalsScreen';

export default function ApprovalsRoute() {
  const { show } = useLocalSearchParams<{ show?: string }>();
  const { colors } = useTheme();
  return (
    <>
      <Stack.Screen options={{ ...headerOptions(colors), headerShown: true, title: TEXT.title }} />
      <ApprovalsScreen show={show} />
    </>
  );
}
