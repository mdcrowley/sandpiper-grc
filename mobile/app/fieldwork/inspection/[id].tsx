// An inspection run on the phone, offline too (wave 15, E38-11). Owner: W15-OFFLINE.
import { useLocalSearchParams } from 'expo-router';
import RunScreen from '../../../src/inspections/RunScreen';

export default function InspectionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RunScreen key={String(id)} id={String(id)} />;
}
