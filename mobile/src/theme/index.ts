// The current theme (light or dark, following the phone's setting). Owner: APP-CORE.
import { useColorScheme } from 'react-native';
import { dark, light, type ColorTokens } from './tokens';

export * from './tokens';

export function useTheme(): { scheme: 'light' | 'dark'; colors: ColorTokens } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { scheme, colors: scheme === 'dark' ? dark : light };
}
