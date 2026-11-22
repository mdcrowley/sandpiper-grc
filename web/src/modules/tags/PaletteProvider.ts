// Extension file (core/CommandPalette.tsx): entries the global search offers for what is typed.
// Owner: TAGS-LOOKUP. Typed text (or a handheld scanner's value and Enter) that looks like a tag number
// is offered first as "Find tag number <text>", opening the tag card page. Bundled into the shell, so
// it stays tiny and imports nothing at run time.
import type { PaletteProvider } from '../../core/CommandPalette';

/** Looks like a tag value: 3 to 60 letters, digits, spaces, dashes, dots, slashes or underscores, with at least one digit. */
const LOOKS_LIKE_TAG = /^(?=.*\d)[\p{L}\p{N}][\p{L}\p{N} ._/-]{2,59}$/u;

export const paletteProvider: PaletteProvider = {
  key: 'asset-tags',
  area: 'tags',
  entries(text) {
    const value = text.trim();
    if (!LOOKS_LIKE_TAG.test(value) || value.split(/\s+/).length > 3) return [];
    return [{
      key: 'find', label: `Find tag number ${value}`, icon: 'tag', section: 'Find',
      hint: 'Asset tag', path: `/asset-tags/find?${new URLSearchParams({ value }).toString()}`,
    }];
  },
};
