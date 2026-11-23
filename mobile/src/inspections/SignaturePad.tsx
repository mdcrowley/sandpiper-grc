// A box to sign in with a finger (wave 15, E38-11). The strokes are drawn as thin bars between the
// points touched; signature.ts turns them into a PNG. Signing is optional: the typed name next to it is
// the signature the server records, so nobody needs the gesture.
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Text, View, type LayoutChangeEvent } from 'react-native';
import { fontSize, radius, space, useTheme } from '../theme';
import { Button } from '../ui';
import type { Stroke } from './signature';

export const PAD_TEXT = {
  label: 'Sign here with your finger (optional)',
  hint: 'Your typed name is your signature; the drawing is added to the inspection as a picture.',
  clear: 'Clear the signature',
};

export function SignaturePad({ strokes, onChange, onSize }: { strokes: Stroke[]; onChange(s: Stroke[]): void; onSize(size: { width: number; height: number }): void }) {
  const { colors } = useTheme();
  const current = useRef<Stroke[]>(strokes);
  current.current = strokes;
  const [, redraw] = useState(0);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      onChange([...current.current, [{ x, y }]]);
    },
    onPanResponderMove: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      const all = current.current.slice();
      const last = all.pop() ?? [];
      onChange([...all, [...last, { x, y }]]);
      redraw((n) => n + 1);
    },
  }), [onChange]);

  const bars: { key: string; left: number; top: number; width: number; angle: number }[] = [];
  strokes.forEach((s, si) => {
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      bars.push({ key: `${si}-${i}`, left: (a.x + b.x) / 2 - len / 2, top: (a.y + b.y) / 2 - 1.5, width: Math.max(len, 1), angle: Math.atan2(b.y - a.y, b.x - a.x) });
    }
  });

  return (
    <View style={{ gap: space[2] }}>
      <Text style={{ color: colors.text, fontSize: fontSize.md, fontWeight: '600' }}>{PAD_TEXT.label}</Text>
      <View
        testID="signature-pad"
        accessible
        accessibilityLabel={PAD_TEXT.label}
        accessibilityHint={PAD_TEXT.hint}
        onLayout={(e: LayoutChangeEvent) => onSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        style={{ height: 160, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, backgroundColor: '#fff', overflow: 'hidden' }}
        {...responder.panHandlers}
      >
        {bars.map((b) => (
          <View key={b.key} pointerEvents="none" style={{ position: 'absolute', left: b.left, top: b.top, width: b.width, height: 3, backgroundColor: '#000', transform: [{ rotate: `${b.angle}rad` }] }} />
        ))}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: fontSize.sm }}>{PAD_TEXT.hint}</Text>
      {strokes.length ? <Button label={PAD_TEXT.clear} kind="secondary" onPress={() => onChange([])} /> : null}
    </View>
  );
}
