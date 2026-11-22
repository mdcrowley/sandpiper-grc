// "Open on the web": a page of the web application in the phone's browser sheet, for what the app does
// not do itself (spec §5.4). Owner: APP-WORK.
import * as WebBrowser from 'expo-web-browser';

/** Opens `path` (for example `/tickets/<id>`) on the signed-in server. */
export async function openOnWeb(server: string | null | undefined, path: string): Promise<void> {
  if (!server) return;
  const base = server.replace(/\/+$/, '');
  await WebBrowser.openBrowserAsync(`${base}${path.startsWith('/') ? path : `/${path}`}`);
}
