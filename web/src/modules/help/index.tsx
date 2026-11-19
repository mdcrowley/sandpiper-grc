// In-app Help. The pages are the Markdown files in docs/user/ - the same files people read
// in the repository - so the user guide has exactly one source.
// This file stays small on purpose: it is part of the application's first load. The pages
// (HelpHome, HelpPage), the Markdown renderer and the guide text are fetched when Help is opened.
import { Suspense, lazy, type ReactNode } from 'react';
import { Loading } from '../../core';
import type { ModuleDef } from '../../core';

const HelpHome = lazy(() => import('./HelpHome'));
const HelpPage = lazy(() => import('./HelpPage'));
const ApiReference = lazy(() => import('./ApiReference'));

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading label="Loading Help" />}>{children}</Suspense>;
}

const mod: ModuleDef = {
  key: 'help',
  nav: [
    { group: 'Help', label: 'User guide', path: '/help', icon: 'book', order: 10 },
    { group: 'Help', label: 'API reference', path: '/help/api', icon: 'file-text', order: 20 },
  ],
  routes: [
    // /help?for=<pathname> goes to the guide section for that screen (see routeMap.ts);
    // /help?q=<words> opens with a search.
    { path: '/help', element: <Lazy><HelpHome /></Lazy> },
    // Before /help/:slug, so "api" is not taken for a guide page.
    { path: '/help/api', element: <Lazy><ApiReference /></Lazy> },
    { path: '/help/:slug', element: <Lazy><HelpPage /></Lazy> },
  ],
};
export default mod;
