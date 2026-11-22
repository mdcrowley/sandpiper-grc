// The stand-in each screen shows until its owner builds it (wave 13 step 0). Delete once unused.
import { StyleSheet, Text, View } from 'react-native';
import { fontSize, space, useTheme } from '../theme';

export function Placeholder({ title, message = 'This screen is being built.' }: { title: string; message?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.box, { backgroundColor: colors.bg }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[5], gap: space[2] },
  title: { fontSize: fontSize.xl, fontWeight: '600' },
  message: { fontSize: fontSize.md, textAlign: 'center' },
});
