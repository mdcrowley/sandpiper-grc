// Small building blocks of the work, search, record and approval screens: themed (light and dark),
// at least 44 points to touch, labeled for VoiceOver and TalkBack, and free to grow with the phone's
// text size (no fixed heights). Owner: APP-WORK.
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { fontSize, radius, space, useTheme, type ChipColor } from '../theme';

export const MIN_TOUCH = 44;

export function Card({ children, accessibilityLabel }: { children: ReactNode; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

export function Heading({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 | 3 }) {
  const { colors } = useTheme();
  const size = level === 1 ? fontSize.xxl : level === 2 ? fontSize.xl : fontSize.lg;
  return <Text accessibilityRole="header" style={{ color: colors.text, fontSize: size, fontWeight: '600' }}>{children}</Text>;
}

export function Body({ children, muted, selectable }: { children: ReactNode; muted?: boolean; selectable?: boolean }) {
  const { colors } = useTheme();
  return <Text selectable={selectable} style={{ color: muted ? colors.textMuted : colors.text, fontSize: fontSize.md, lineHeight: fontSize.md * 1.4 }}>{children}</Text>;
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'link';

export function Button({ label, onPress, kind = 'secondary', disabled, busy, hint, testID }: {
  label: string; onPress: () => void; kind?: ButtonKind; disabled?: boolean; busy?: boolean; hint?: string; testID?: string;
}) {
  const { colors } = useTheme();
  const off = disabled || busy;
  const look = {
    primary: { bg: colors.brand, fg: colors.brandContrast, border: colors.brand },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.borderControl },
    danger: { bg: colors.danger, fg: colors.dangerContrast, border: colors.danger },
    link: { bg: 'transparent', fg: colors.link, border: 'transparent' },
  }[kind];
  return (
    <Pressable
      testID={testID}
      accessibilityRole={kind === 'link' ? 'link' : 'button'}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.bg, borderColor: look.border, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        kind === 'link' && styles.linkButton,
      ]}
    >
      {busy ? <ActivityIndicator color={look.fg} accessibilityElementsHidden importantForAccessibility="no" /> : null}
      <Text style={{ color: look.fg, fontSize: fontSize.md, fontWeight: kind === 'link' ? '500' : '600', textDecorationLine: kind === 'link' ? 'underline' : 'none' }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, color = 'gray' }: { label: string; color?: ChipColor | string | null }) {
  const { colors } = useTheme();
  const c = colors.chips[(color && color in colors.chips ? color : 'gray') as ChipColor];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={{ color: c.fg, fontSize: fontSize.sm, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

/** A label above its value (stacks, so long labels and large text never clip). */
export function FieldRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.fieldRow}>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{label}</Text>
      <Text selectable style={{ color: colors.text, fontSize: fontSize.md }}>{value}</Text>
    </View>
  );
}

export function Notice({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'info' | 'success' }) {
  const { colors } = useTheme();
  const c = kind === 'error' ? colors.chips.red : kind === 'success' ? colors.chips.green : colors.chips.blue;
  return (
    <View
      accessibilityRole={kind === 'error' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: c.bg, borderColor: c.solid }]}
    >
      <Text style={{ color: c.fg, fontSize: fontSize.md }}>{children}</Text>
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={label} accessibilityRole="progressbar" style={styles.loading}>
      <ActivityIndicator color={colors.brand} />
      <Text style={{ color: colors.textMuted, fontSize: fontSize.md }}>{label}…</Text>
    </View>
  );
}

/** A row of choices that works as tabs (a button per choice, never a swipe). */
export function Segmented<K extends string>({ options, value, onChange, label }: {
  options: { key: K; label: string }[]; value: K; onChange: (key: K) => void; label: string;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.segmented}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.segment, { backgroundColor: on ? colors.brandSoft : colors.surface, borderColor: on ? colors.brand : colors.borderControl }]}
          >
            <Text style={{ color: on ? colors.brandStrong : colors.text, fontSize: fontSize.md, fontWeight: on ? '600' : '400' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TextField({ label, error, hint, ...input }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>{label}</Text>
      {hint ? <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.textMuted}
        {...input}
        style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.borderControl }, input.multiline && styles.multiline]}
      />
      {error ? <Text accessibilityRole="alert" style={{ color: colors.dangerText, fontSize: fontSize.sm }}>{error}</Text> : null}
    </View>
  );
}

export function SwitchField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.switchRow]}>
      <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600', flexShrink: 1 }}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: colors.brand, false: colors.borderControl }} />
    </View>
  );
}

/** A tappable row of a list: title, details under it, and a role of link. */
export function ListRow({ title, details, onPress, hint, right, testID }: {
  title: string; details?: (string | null | undefined | false)[]; onPress: () => void; hint?: string; right?: ReactNode; testID?: string;
}) {
  const { colors } = useTheme();
  const lines = (details ?? []).filter(Boolean) as string[];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, ...lines].join(', ')}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceHover : 'transparent' }]}
    >
      <View style={styles.rowText}>
        <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>{title}</Text>
        {lines.map((l, i) => <Text key={i} style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{l}</Text>)}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space[4], gap: space[3] },
  button: {
    minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space[4], paddingVertical: space[2],
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2],
  },
  linkButton: { paddingHorizontal: 0, justifyContent: 'flex-start' },
  chip: { borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: 2, alignSelf: 'flex-start' },
  fieldRow: { gap: 2, paddingVertical: space[1] },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: space[3] },
  loading: { padding: space[5], alignItems: 'center', gap: space[2] },
  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  segment: { minHeight: MIN_TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2], justifyContent: 'center' },
  field: { gap: space[1] },
  input: { minHeight: MIN_TOUCH, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2], fontSize: fontSize.lg },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  switchRow: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], flexWrap: 'wrap' },
  row: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3], borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
});
