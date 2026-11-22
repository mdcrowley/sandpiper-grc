// A record's phone view (E38-07): /record/<type>/<id>. Owner: APP-WORK. The screen is in src/records.
import { useLocalSearchParams } from 'expo-router';
import RecordScreen from '../../../src/records/screens/RecordScreen';

export default function RecordRoute() {
  const { type, id } = useLocalSearchParams<{ type: string; id: string }>();
  return <RecordScreen key={`${type}:${id}`} type={String(type)} id={String(id)} />;
}
