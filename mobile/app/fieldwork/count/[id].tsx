// Counting mode for an inventory count, offline too (wave 15, E38-12). Owner: W15-OFFLINE.
import { useLocalSearchParams } from 'expo-router';
import CountScreen from '../../../src/counts/CountScreen';

export default function CountRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CountScreen key={String(id)} id={String(id)} />;
}
