import { localized } from '../i18n';
// Names of the tabs along the bottom (app/(tabs)/_layout.tsx).
export const tabsText = localized('tabs', {
  work: 'My work',
  tag: 'Tag',
  report: 'Report',
  search: 'Search',
  account: 'Account',
} as const);
