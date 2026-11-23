// Small building blocks every screen uses, drawn with the theme tokens (light and dark). Owner: APP-CORE.
// Touch targets are at least 48 points; every control has an accessibility role and a name that starts
// with its visible text; messages are said by the screen reader when they appear (./a11y.ts); nothing
// has a fixed height, so text can grow to 200% (E38-15).
import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fontSize, radius, space, useTheme } from '../theme';
import { plainText, useAnnounce, type TextRef } from './a11y';

export { announce, useAnnounce, useFocusOn, type TextRef } from './a11y';

export function Screen({ children, scroll = true, edges }: { children: ReactNode; scroll?: boolean; edges?: ('top' | 'bottom')[] }) {
  const { colors } = useTheme();
  const body = scroll
    ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[styles.content, { flex: 1 }]}>{children}</View>;
  return <SafeAreaView edges={edges ?? []} style={{ flex: 1, backgroundColor: colors.bg }}>{body}</SafeAreaView>;
}

export const Title = forwardRef<TextRef, { children: ReactNode }>(function Title({ children }, ref) {
  const { colors } = useTheme();
  return <Text ref={ref} accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{children}</Text>;
});

export function Body({ children, muted = false, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const { colors } = useTheme();
  return <Text style={[styles.body, { color: muted ? colors.textMuted : colors.text }, style]}>{children}</Text>;
}

/** A button. `accessibilityLabel` may add what it acts on, after the visible words ("Discard: Report a leak"). */
export function Button({
  label, onPress, kind = 'primary', busy = false, disabled = false, accessibilityHint, accessibilityLabel,
}: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean; accessibilityHint?: string; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  const bg = kind === 'primary' ? colors.brand : kind === 'danger' ? colors.danger : colors.surface;
  const fg = kind === 'primary' ? colors.brandContrast : kind === 'danger' ? colors.dangerContrast : colors.text;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
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
  useAnnounce(error);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.textMuted}
        {...input}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.borderStrong }, input.multiline && styles.multiline, input.style]}
      />
      {hint && !error ? <Text style={[styles.small, { color: colors.textMuted }]}>{hint}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.small, { color: colors.dangerText }]}>{error}</Text> : null}
    </View>
  );
}

/**
 * A message box: `info` (brand tint), `warning` (amber) or `error`. Warnings and errors are said by the
 * screen reader when they appear or change; `announce` says an info message too (a status change).
 */
export function Banner({ kind = 'info', children, announce }: { kind?: 'info' | 'warning' | 'error'; children: ReactNode; announce?: boolean }) {
  const { colors } = useTheme();
  useAnnounce(plainText(children), { enabled: announce ?? kind !== 'info' });
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
      {/* Drawn in capitals, but named as written, so screen readers never spell it out letter by letter. */}
      {title ? <Text accessibilityRole="header" accessibilityLabel={title} style={[styles.sectionTitle, { color: colors.textMuted }]}>{title}</Text> : null}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

/**
 * One row in a Section: a label, a value or detail, and optionally an action when pressed. A pressable
 * row is one button whose name is its label, value and detail, in the order shown; `selected` marks a
 * choice in a list (a check mark, and "selected" for the screen reader); `expanded` a row that opens a
 * list under it. A row with a control at the right (a switch, a button) keeps that control a separate
 * item, so VoiceOver and TalkBack can reach it.
 */
export function Row({
  label, value, detail, onPress, right, last = false, accessibilityHint, accessibilityLabel, selected, expanded,
}: {
  label: string; value?: string | null; detail?: string | null; onPress?: () => void; right?: ReactNode; last?: boolean;
  accessibilityHint?: string; accessibilityLabel?: string; selected?: boolean; expanded?: boolean;
}) {
  const { colors } = useTheme();
  const spoken = accessibilityLabel ?? [label, value, detail].filter(Boolean).join(', ');
  const shown = selected ? '✓' : value;
  const text = (
    // With a value beside it, the label takes the width it needs and the value moves under it when both do
    // not fit (at large text sizes), rather than either breaking in the middle of a word.
    <View style={shown ? styles.rowLabel : { flex: 1 }}>
      <Text style={[styles.body, { color: onPress ? colors.link : colors.text }]}>{label}</Text>
      {detail ? <Text style={[styles.small, { color: colors.textMuted }]}>{detail}</Text> : null}
    </View>
  );
  const valueText = shown ? (
    <Text
      style={[styles.body, styles.rowValue, { color: selected ? colors.brand : colors.textMuted, fontWeight: selected ? '700' : '400' }]}>
      {shown}
    </Text>
  ) : null;
  const line = [styles.row, shown && styles.rowWrap, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }];
  if (!onPress) {
    if (!right) return <View accessible accessibilityLabel={spoken} style={line}>{text}{valueText}</View>;
    // The text is one item and the control at the right another (inside one accessible view,
    // VoiceOver could not reach the control).
    return (
      <View style={line}>
        <View accessible accessibilityLabel={spoken} style={styles.rowText}>{text}{valueText}</View>
        {right}
      </View>
    );
  }
  const state: { selected?: boolean; expanded?: boolean } = {};
  if (selected !== undefined) state.selected = selected;
  if (expanded !== undefined) state.expanded = expanded;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint={accessibilityHint} accessibilityState={state} onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceHover : 'transparent' } as ViewStyle)}>
      <View style={line}>{text}{valueText}{right}</View>
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
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2], fontSize: fontSize.lg },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  rowText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  button: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[4] },
  buttonText: { fontSize: fontSize.lg, fontWeight: '600', textAlign: 'center' },
  banner: { borderRadius: radius.md, padding: space[3] },
  section: { gap: space[2] },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: space[1] },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { minHeight: 48, paddingHorizontal: space[4], paddingVertical: space[3], flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowWrap: { flexWrap: 'wrap' },
  rowLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
  rowValue: { flexGrow: 1, flexShrink: 1, textAlign: 'right' },
});

/**
 * A row that is one switch (E38-15): the whole row, at least 48 points high, turns it on or off, and
 * VoiceOver and TalkBack read it as a switch named by its label, with the detail after. (A bare Switch
 * is only about 46 by 35 points on Android, under the 48 asked for.)
 */
export function SwitchRow({
  label, detail, value, onChange, disabled = false, last = false,
}: { label: string; detail?: string | null; value: boolean; onChange: (on: boolean) => void; disabled?: boolean; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={[label, detail].filter(Boolean).join(', ')}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.body, { color: colors.text }]}>{label}</Text>
        {detail ? <Text style={[styles.small, { color: colors.textMuted }]}>{detail}</Text> : null}
      </View>
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} disabled={disabled} trackColor={{ true: colors.brand, false: colors.borderStrong }} />
      </View>
    </Pressable>
  );
}
