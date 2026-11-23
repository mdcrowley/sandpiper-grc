// Design tokens of the app, copied from the web application's web/src/core/tokens.css (light and dark),
// so the app looks like the same product. When tokens.css changes, change these too. Owner: APP-CORE.

export interface ColorTokens {
  brand: string; brandHover: string; brandContrast: string; brandSoft: string; brandStrong: string; accent: string;
  bg: string; surface: string; surface2: string; surfaceHover: string;
  border: string; borderControl: string; borderStrong: string;
  text: string; textMuted: string; link: string;
  danger: string; dangerContrast: string; dangerText: string; focus: string; overlay: string;
  chips: Record<ChipColor, { bg: string; fg: string; solid: string }>;
}

export type ChipColor = 'gray' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'purple';

export const light: ColorTokens = {
  brand: '#17656f', brandHover: '#0f525b', brandContrast: '#ffffff', brandSoft: '#e1f0f0', brandStrong: '#0a3d45', accent: '#b9782a',
  bg: '#f3f6f6', surface: '#ffffff', surface2: '#edf2f3', surfaceHover: '#f4f8f8',
  border: '#dbe3e5', borderControl: '#b9c5c9', borderStrong: '#7b8a90',
  text: '#14252b', textMuted: '#50626a', link: '#14606a',
  danger: '#b42a2a', dangerContrast: '#ffffff', dangerText: '#a32222', focus: '#1c7480', overlay: 'rgba(10, 30, 36, 0.48)',
  chips: {
    gray: { bg: '#e9eef0', fg: '#3c4b52', solid: '#6a7a81' },
    blue: { bg: '#e1edfb', fg: '#164e8c', solid: '#2a78d6' },
    teal: { bg: '#d8f1ee', fg: '#0c5753', solid: '#14908a' },
    green: { bg: '#dff2e2', fg: '#1b5a29', solid: '#2a9143' },
    amber: { bg: '#fcefc9', fg: '#6b4700', solid: '#c98500' },
    orange: { bg: '#fde5d3', fg: '#853609', solid: '#dd6420' },
    red: { bg: '#fde2e0', fg: '#951b1b', solid: '#d03b3b' },
    purple: { bg: '#ebe5fa', fg: '#50309a', solid: '#6f52d0' },
  },
};

export const dark: ColorTokens = {
  brand: '#5fb3b8', brandHover: '#86c9cc', brandContrast: '#06262b', brandSoft: '#16353b', brandStrong: '#b3dcde', accent: '#e2b06d',
  bg: '#0d1416', surface: '#151e21', surface2: '#1d282c', surfaceHover: '#1a2529',
  border: '#2a383d', borderControl: '#3d4e54', borderStrong: '#6d7f85',
  text: '#e4ecee', textMuted: '#a0b1b6', link: '#86c9cc',
  danger: '#f08a85', dangerContrast: '#2b0c0b', dangerText: '#f59c97', focus: '#86c9cc', overlay: 'rgba(0, 0, 0, 0.62)',
  chips: {
    gray: { bg: '#29353a', fg: '#c7d1d5', solid: '#8798a0' },
    blue: { bg: '#162f4c', fg: '#a3ccf8', solid: '#3987e5' },
    teal: { bg: '#0f3735', fg: '#88ddd6', solid: '#23a69f' },
    green: { bg: '#173920', fg: '#98dca6', solid: '#37a651' },
    amber: { bg: '#3f2f0a', fg: '#f2cf73', solid: '#d59a1c' },
    orange: { bg: '#44230e', fg: '#f8b48a', solid: '#e0763a' },
    red: { bg: '#491c1c', fg: '#f8aaa5', solid: '#e06060' },
    purple: { bg: '#2d2350', fg: '#c8b4f6', solid: '#9085e9' },
  },
};

/** Spacing (tokens.css --s-1 to --s-7), radii and type sizes in points. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;
export const radius = { sm: 6, md: 8, lg: 12 } as const;
export const fontSize = { xs: 12, sm: 13, md: 14, lg: 16, xl: 20, xxl: 26, xxxl: 32 } as const;

/**
 * Size of the titles in the screens' top bars. Given explicitly so that, on Android, the title grows
 * with the phone's text size like all other text (left to the default, it stayed the same at 200%).
 */
export const HEADER_TITLE_SIZE = 20;
