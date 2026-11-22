// The app's first address: My work when signed in, Connect otherwise (app/_layout.tsx decides).
import { Redirect } from 'expo-router';
import { useAuthState } from '../src/api/client';
import { commonText } from '../src/text/common';
import { Loading } from '../src/ui';

export default function Index() {
  const auth = useAuthState();
  if (auth.status === 'loading') return <Loading label={commonText.loading} />;
  return <Redirect href={auth.status === 'signed-in' ? '/work' : '/connect'} />;
}
