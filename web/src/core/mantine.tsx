// Mantine set-up: the component library under the design system.
// Colors are decided in tokens.css; the resolver below points Mantine's variables at those
// tokens so the two never disagree. Mantine's styles load in the `mantine` cascade layer, so any
// ordinary (unlayered) CSS in the core or in a module wins over them without `!important`.
import '@mantine/core/styles.layer.css';
import '@mantine/dates/styles.layer.css';
import '@mantine/notifications/styles.layer.css';
import type { ReactNode } from 'react';
import {
  ActionIcon, Badge, Button, createTheme, Drawer, Input, InputWrapper, MantineProvider, Menu, Modal, Notification,
  Popover, Tooltip, defaultVariantColorsResolver,
  type CSSVariablesResolver, type MantineColorsTuple, type VariantColorsResolver,
} from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useTheme } from './theme';

/** Brand scale. Index 7 is `--brand` in the light theme, index 4 in the dark theme. Change here (and in tokens.css) to re-brand. */
const brand: MantineColorsTuple = [
  '#edf7f7', '#d8ecec', '#b3dadb', '#86c9cc', '#5fb3b8', '#3f9aa1', '#267f88', '#17656f', '#0f525b', '#0a3d45',
];
/** Neutrals with a slight blue-green cast, so grays sit comfortably beside the brand. */
const gray: MantineColorsTuple = [
  '#f3f6f6', '#edf2f3', '#e3e9eb', '#dbe3e5', '#b9c5c9', '#9aa8ad', '#7b8a90', '#50626a', '#33434a', '#14252b',
];
const dark: MantineColorsTuple = [
  '#e4ecee', '#bcc9cd', '#a0b1b6', '#6d7f85', '#3d4e54', '#2a383d', '#1d282c', '#151e21', '#0d1416', '#080d0e',
];
const amber: MantineColorsTuple = [
  '#fff8e1', '#fcefc9', '#f8de94', '#f3cb5c', '#eeba2f', '#e5a913', '#c98500', '#a06a00', '#6b4700', '#4a3100',
];
const purple: MantineColorsTuple = [
  '#f3effc', '#ebe5fa', '#d3c7f3', '#b9a6ec', '#a28ae5', '#9085e9', '#6f52d0', '#5c3fb8', '#50309a', '#39216f',
];

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Text on filled brand and danger surfaces comes from the tokens: in the dark theme the brand is a
 * light tone that needs dark text, which Mantine's own contrast rule (worked out for the light theme) misses.
 */
const variantColorResolver: VariantColorsResolver = (input) => {
  const resolved = defaultVariantColorsResolver(input);
  const name = input.color ?? input.theme.primaryColor;
  if (input.variant === 'filled' && name === 'brand') return { ...resolved, color: 'var(--brand-contrast)' };
  if (input.variant === 'filled' && name === 'red') return { ...resolved, color: 'var(--danger-contrast)' };
  return resolved;
};

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 7, dark: 8 },
  variantColorResolver,
  colors: { brand, gray, dark, amber, purple },
  white: '#ffffff',
  black: '#14252b',
  autoContrast: true,
  luminanceThreshold: 0.3,
  fontFamily: FONT,
  fontFamilyMonospace: 'ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", monospace',
  headings: {
    fontFamily: FONT,
    fontWeight: '650',
    sizes: {
      h1: { fontSize: '1.625rem', lineHeight: '1.25' },
      h2: { fontSize: '1.25rem', lineHeight: '1.3' },
      h3: { fontSize: '1rem', lineHeight: '1.4' },
      h4: { fontSize: '0.875rem', lineHeight: '1.45' },
    },
  },
  radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
  spacing: { xs: '8px', sm: '12px', md: '16px', lg: '24px', xl: '32px' },
  shadows: {
    xs: 'var(--shadow-1)', sm: 'var(--shadow-1)', md: 'var(--shadow-2)', lg: 'var(--shadow-2)', xl: 'var(--shadow-3)',
  },
  defaultRadius: 'md',
  cursorType: 'pointer',
  focusRing: 'auto',
  respectReducedMotion: true,
  components: {
    Button: Button.extend({ defaultProps: { size: 'sm' } }),
    ActionIcon: ActionIcon.extend({ defaultProps: { size: 'lg', variant: 'subtle', color: 'gray' } }),
    Badge: Badge.extend({ defaultProps: { radius: 'xl', variant: 'light' }, styles: { label: { textTransform: 'none' } } }),
    Tooltip: Tooltip.extend({ defaultProps: { openDelay: 350, withArrow: true, events: { hover: true, focus: true, touch: false } } }),
    Modal: Modal.extend({ defaultProps: { centered: true, radius: 'lg', overlayProps: { backgroundOpacity: 1, color: 'var(--overlay)' } } }),
    Drawer: Drawer.extend({ defaultProps: { overlayProps: { backgroundOpacity: 1, color: 'var(--overlay)' } } }),
    Menu: Menu.extend({ defaultProps: { shadow: 'md', radius: 'md', withinPortal: true } }),
    Popover: Popover.extend({ defaultProps: { shadow: 'md', radius: 'md' } }),
    Notification: Notification.extend({ defaultProps: { radius: 'md', withBorder: true } }),
    // Every Mantine input is built on Input and InputWrapper, so these classes reach them all (see base.css).
    Input: Input.extend({ classNames: { wrapper: 'ui-input-wrap', input: 'ui-input' } }),
    InputWrapper: InputWrapper.extend({ classNames: { label: 'ui-label' } }),
    // The clear (x) button Mantine adds to clearable inputs, date inputs among them, has no name of its own.
    InputClearButton: Input.ClearButton.extend({ defaultProps: { 'aria-label': 'Clear value' } }),
  },
});

const NAMED = ['gray', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'] as const;

/** Points Mantine's semantic variables at the design tokens (which switch with the theme). */
const resolver: CSSVariablesResolver = () => {
  const shared: Record<string, string> = {
    '--mantine-color-text': 'var(--text)',
    '--mantine-color-bright': 'var(--text)',
    '--mantine-color-body': 'var(--surface)',
    '--mantine-color-default': 'var(--surface)',
    '--mantine-color-default-hover': 'var(--surface-2)',
    '--mantine-color-default-color': 'var(--text)',
    '--mantine-color-default-border': 'var(--border-control)',
    '--mantine-color-dimmed': 'var(--text-muted)',
    '--mantine-color-placeholder': 'var(--text-muted)',
    '--mantine-color-anchor': 'var(--link)',
    '--mantine-color-error': 'var(--danger-text)',
    '--mantine-primary-color-contrast': 'var(--brand-contrast)',
    '--mantine-color-brand-contrast': 'var(--brand-contrast)',
    '--mantine-color-brand-filled': 'var(--brand)',
    '--mantine-color-brand-filled-hover': 'var(--brand-hover)',
    '--mantine-color-brand-light': 'var(--brand-soft)',
    '--mantine-color-brand-light-hover': 'color-mix(in srgb, var(--brand-soft) 82%, var(--brand))',
    '--mantine-color-brand-light-color': 'var(--link)',
    '--mantine-color-brand-outline': 'var(--link)',
    '--mantine-color-brand-text': 'var(--link)',
    '--mantine-color-red-filled': 'var(--danger)',
    '--mantine-color-red-filled-hover': 'color-mix(in srgb, var(--danger) 86%, var(--text))',
    '--mantine-color-red-text': 'var(--danger-text)',
  };
  for (const name of NAMED) {
    shared[`--mantine-color-${name}-light`] = `var(--c-${name}-bg)`;
    shared[`--mantine-color-${name}-light-color`] = `var(--c-${name}-fg)`;
    shared[`--mantine-color-${name}-light-hover`] = `color-mix(in srgb, var(--c-${name}-bg) 86%, var(--c-${name}-solid))`;
    shared[`--mantine-color-${name}-outline`] = `var(--c-${name}-fg)`;
  }
  return { variables: {}, light: shared, dark: shared };
};

export function UiProvider({ children }: { children: ReactNode }) {
  const { theme: scheme } = useTheme();
  return (
    <MantineProvider theme={theme} forceColorScheme={scheme} cssVariablesResolver={resolver}>
      <Notifications position="bottom-right" limit={4} zIndex={1000} />
      {children}
    </MantineProvider>
  );
}
