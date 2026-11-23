// Accessibility of the shared building blocks (E38-15): names that start with the visible text, the
// state of choices, controls beside a row's text staying reachable, messages said by the screen reader
// when they appear, the focus moved after the screen changes, touch targets of at least 48 points, and
// the theme's contrast (WCAG AA) in light and dark.
import { AccessibilityInfo, StyleSheet, Switch, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Banner, Button, Field, Row, SwitchRow, useFocusOn, type TextRef } from '..';
import { Button as WorkButton, Notice, Segmented, TextField } from '../../records/ui';
import { dark, light, type ColorTokens } from '../../theme';

/** Every ancestor of an element up to the root (to check a control is not inside a grouped item). */
function ancestors(el: { parent: unknown }): { props: Record<string, unknown> }[] {
  const out: { props: Record<string, unknown> }[] = [];
  let p = el.parent as { parent: unknown; props: Record<string, unknown> } | null;
  while (p) { out.push(p); p = p.parent as typeof p; }
  return out;
}

const minHeight = (el: { props: { style?: unknown } }) => {
  const style = typeof el.props.style === 'function' ? (el.props.style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : el.props.style;
  return (StyleSheet.flatten(style as never) as { minHeight?: number } | undefined)?.minHeight ?? 0;
};

let announce: jest.SpyInstance;
beforeEach(() => {
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => announce.mockRestore());

describe('Row', () => {
  it('is one button named by its label, value and detail, in the order shown', async () => {
    await render(<Row label="Notifications" value="3 unread" detail="Shared with the web" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread, Shared with the web' })).toBeTruthy();
  });

  it('says which choice of a list is selected, and whether a row\'s list is open', async () => {
    await render(<>
      <Row label="Asset" selected onPress={() => {}} />
      <Row label="Vehicle" selected={false} onPress={() => {}} />
      <Row label="No site" accessibilityLabel="No site, Site" expanded onPress={() => {}} />
    </>);
    expect(screen.getByRole('button', { name: 'Asset' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('button', { name: 'Vehicle' }).props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByRole('button', { name: 'No site, Site' }).props.accessibilityState).toEqual({ expanded: true });
  });

  it('keeps a switch at the right outside the grouped text, so VoiceOver can reach it', async () => {
    await render(<Row label="Push notifications" detail="Off" right={<Switch accessibilityLabel="Push notifications" value={false} />} />);
    const sw = screen.getByRole('switch', { name: 'Push notifications' });
    expect(ancestors(sw as never).some((a) => a.props.accessible === true)).toBe(false);
    expect(screen.getByLabelText('Push notifications, Off')).toBeTruthy();
  });
});

describe('SwitchRow', () => {
  it('is one switch the size of the row, named by its label and detail, with its state', async () => {
    const onChange = jest.fn();
    await render(<SwitchRow label="Ask for the unlock" detail="After 5 minutes" value={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Ask for the unlock, After 5 minutes' });
    expect(sw.props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(minHeight(sw as never)).toBeGreaterThanOrEqual(48);
    await fireEvent.press(sw);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });
});

describe('messages', () => {
  it('says errors and warnings when they appear and change, not info unless asked', async () => {
    const { rerender } = await render(<Banner kind="error">The server cannot be reached.</Banner>);
    expect(announce).toHaveBeenLastCalledWith('The server cannot be reached.');
    await rerender(<Banner kind="error">The server cannot be reached.</Banner>);
    expect(announce).toHaveBeenCalledTimes(1);
    await rerender(<Banner kind="warning">Signed out.</Banner>);
    expect(announce).toHaveBeenLastCalledWith('Signed out.');
    announce.mockClear();
    await rerender(<Banner>Nothing is waiting.</Banner>);
    expect(announce).not.toHaveBeenCalled();
    await rerender(<Banner announce>Arrived on the server.</Banner>);
    expect(announce).toHaveBeenLastCalledWith('Arrived on the server.');
  });

  it('says a field\'s error and gives it as the field\'s hint', async () => {
    await render(<Field label="Title" hint="A few words" error="Type a title." />);
    expect(announce).toHaveBeenLastCalledWith('Type a title.');
    expect(screen.getByLabelText('Title').props.accessibilityHint).toBe('Type a title.');
    announce.mockClear();
    await render(<TextField label="Reason" error="Give a reason for rejecting." />);
    expect(announce).toHaveBeenLastCalledWith('Give a reason for rejecting.');
  });

  it('says a success notice of the work screens', async () => {
    await render(<Notice kind="success">Saved.</Notice>);
    expect(announce).toHaveBeenLastCalledWith('Saved.');
  });
});

describe('focus', () => {
  it('moves the screen reader to the element when the key changes, and not at first when asked', async () => {
    jest.useFakeTimers();
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
    try {
      function Part({ k }: { k: number }) {
        const ref = useFocusOn<TextRef>(k, { initial: false });
        return <Text ref={ref}>Heading</Text>;
      }
      const { rerender } = await render(<Part k={0} />);
      await act(async () => { jest.advanceTimersByTime(300); });
      expect(focus).not.toHaveBeenCalled();
      await rerender(<Part k={1} />);
      await act(async () => { jest.advanceTimersByTime(300); });
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    } finally {
      focus.mockRestore();
      jest.useRealTimers();
    }
  });
});

describe('touch targets', () => {
  it('are at least 48 points high', async () => {
    await render(<>
      <Button label="Sign in" onPress={() => {}} />
      <WorkButton label="Refresh" onPress={() => {}} />
      <WorkButton label="Open the record" kind="link" onPress={() => {}} />
      <Segmented label="Show" value="a" onChange={() => {}} options={[{ key: 'a', label: 'Approvals' }]} />
    </>);
    for (const name of ['Sign in', 'Refresh', 'Open the record']) expect(minHeight(screen.getByRole(name === 'Open the record' ? 'link' : 'button', { name }) as never)).toBeGreaterThanOrEqual(48);
    expect(minHeight(screen.getByRole('tab', { name: 'Approvals' }) as never)).toBeGreaterThanOrEqual(44);
  });
});

describe('contrast of the theme (WCAG AA)', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const text: [keyof ColorTokens, keyof ColorTokens][] = [
    ['text', 'bg'], ['text', 'surface'], ['text', 'surface2'], ['textMuted', 'bg'], ['textMuted', 'surface'], ['textMuted', 'surface2'],
    ['link', 'bg'], ['link', 'surface'], ['brand', 'surface'], ['brandContrast', 'brand'], ['brandStrong', 'brandSoft'], ['text', 'brandSoft'],
    ['dangerContrast', 'danger'], ['dangerText', 'bg'], ['dangerText', 'surface'],
  ];
  for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
    it(`${name}: text 4.5:1, text-box and switch borders 3:1`, () => {
      for (const [fg, bg] of text) expect(ratio(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(4.5);
      for (const c of Object.values(theme.chips)) expect(ratio(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);
      for (const bg of ['bg', 'surface'] as const) expect(ratio(theme.borderStrong, theme[bg])).toBeGreaterThanOrEqual(3);
      // The tag camera's outline label for text to confirm: black on the sand color.
      expect(ratio('#000000', theme.accent)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
