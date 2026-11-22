// Small building blocks every screen uses, drawn with the theme tokens (light and dark). Owner: APP-CORE.
// Touch targets are at least 44 points; every control has an accessibility role and label.
import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontSize, radius, space, useTheme } from '../theme';

export function Screen({ children, scroll = true, edges }: { children: ReactNode; scroll?: boolean; edges?: ('top' | 'bottom')[] }) {
  const { colors } = useTheme();
  const body = scroll
    ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[styles.content, { flex: 1 }]}>{children}</View>;
  return <SafeAreaView edges={edges ?? []} style={{ flex: 1, backgroundColor: colors.bg }}>{body}</SafeAreaView>;
}

export function Title({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{children}</Text>;
}

export function Body({ children, muted = false, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const { colors } = useTheme();
  return <Text style={[styles.body, { color: muted ? colors.textMuted : colors.text }, style]}>{children}</Text>;
}

export function Button({
  label, onPress, kind = 'primary', busy = false, disabled = false, accessibilityHint,
}: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean; accessibilityHint?: string }) {
  const { colors } = useTheme();
  const bg = kind === 'primary' ? colors.brand : kind === 'danger' ? colors.danger : colors.surface;
  const fg = kind === 'primary' ? colors.brandContrast : kind === 'danger' ? colors.dangerContrast : colors.text;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? colors.borderControl : bg, opacity: off ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.textMuted}
        {...input}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.borderControl }]}
      />
      {hint && !error ? <Text style={[styles.small, { color: colors.textMuted }]}>{hint}</Text> : null}
      {error ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.small, { color: colors.dangerText }]}>{error}</Text> : null}
    </View>
  );
}

/** A message box: `info` (brand tint), `warning` (amber) or `error`. */
export function Banner({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'error'; children: ReactNode }) {
  const { colors } = useTheme();
  const c = kind === 'error' ? colors.chips.red : kind === 'warning' ? colors.chips.amber : { bg: colors.brandSoft, fg: colors.brandStrong };
  return (
    <View accessibilityRole={kind === 'info' ? 'text' : 'alert'} style={[styles.banner, { backgroundColor: c.bg }]}>
      <Text style={[styles.body, { color: c.fg }]}>{children}</Text>
    </View>
  );
}

/** A grouped section with a heading, as on the Account screen. */
export function Section({ title, children }: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      {title ? <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text> : null}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

/** One row in a Section: a label, a value or detail, and optionally an action when pressed. */
export function Row({
  label, value, detail, onPress, right, last = false, accessibilityHint,
}: { label: string; value?: string | null; detail?: string | null; onPress?: () => void; right?: ReactNode; last?: boolean; accessibilityHint?: string }) {
  const { colors } = useTheme();
  const inner = (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.body, { color: onPress ? colors.link : colors.text }]}>{label}</Text>
        {detail ? <Text style={[styles.small, { color: colors.textMuted }]}>{detail}</Text> : null}
      </View>
      {value ? <Text style={[styles.body, { color: colors.textMuted, maxWidth: '55%', textAlign: 'right' }]}>{value}</Text> : null}
      {right}
    </View>
  );
  if (!onPress) return <View accessible accessibilityLabel={[label, value, detail].filter(Boolean).join(', ')}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceHover : 'transparent' } as ViewStyle)}>
      {inner}
    </Pressable>
  );
}

export function Loading({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.center, { backgroundColor: colors.bg }]} accessible accessibilityLabel={label}>
      <ActivityIndicator color={colors.brand} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space[4], gap: space[4] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.xxl, fontWeight: '700' },
  body: { fontSize: fontSize.lg, lineHeight: 22 },
  small: { fontSize: fontSize.md, lineHeight: 18 },
  label: { fontSize: fontSize.md, fontWeight: '600' },
  field: { gap: space[1] },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space[3], fontSize: fontSize.lg },
  button: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[4] },
  buttonText: { fontSize: fontSize.lg, fontWeight: '600' },
  banner: { borderRadius: radius.md, padding: space[3] },
  section: { gap: space[2] },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: space[1] },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { minHeight: 48, paddingHorizontal: space[4], paddingVertical: space[3], flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
