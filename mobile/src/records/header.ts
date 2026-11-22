// Stack header colors of the work, search, record and approval screens, following the theme (light
// and dark), as the Account tab does. Owner: APP-WORK.
import type { ColorTokens } from '../theme';

export function headerOptions(colors: ColorTokens) {
  return {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.brand,
    headerTitleStyle: { color: colors.text },
    contentStyle: { backgroundColor: colors.bg },
  };
}
