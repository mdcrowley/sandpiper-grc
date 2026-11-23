// Screen reader helpers (E38-15): saying a message once when it appears or changes, and putting the
// screen reader's focus on a heading after the screen changes under it. Owner: APP-CORE.
//
// Messages: TalkBack (Android) reads a view marked `accessibilityLiveRegion` when its text changes, but
// VoiceOver (iPhone) has no live regions, and a message box that is newly shown is not reliably read by
// either. `useAnnounce` asks the system to say the text (AccessibilityInfo.announceForAccessibility)
// when it appears or changes, on both platforms, or on iPhone only for text that already sits in a live
// region on Android (so it is never said twice).
import { useEffect, useRef } from 'react';
import type { ComponentRef } from 'react';
import { AccessibilityInfo, Platform, type Text } from 'react-native';

/** What a ref to a Text holds (a heading to move the focus to). */
export type TextRef = ComponentRef<typeof Text>;

/** Says `text` once each time it appears or changes (never for null or empty text). */
export function useAnnounce(text: string | null | undefined, options: { iosOnly?: boolean; enabled?: boolean } = {}): void {
  const { iosOnly = false, enabled = true } = options;
  const last = useRef<string | null>(null);
  useEffect(() => {
    const value = enabled && text ? text : null;
    if (value && value !== last.current && (!iosOnly || Platform.OS === 'ios')) announce(value);
    last.current = value;
  }, [text, iosOnly, enabled]);
}

export function announce(text: string): void {
  try {
    AccessibilityInfo.announceForAccessibility(text);
  } catch {
    // No screen reader support on this platform (tests, web): nothing to say.
  }
}

/** The text of a message's children when it is plain text (what `useAnnounce` can say). */
export function plainText(children: unknown): string | null {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children) && children.every((c) => typeof c === 'string' || typeof c === 'number' || c == null || c === false)) {
    const s = children.filter((c) => c != null && c !== false).join('');
    return s || null;
  }
  return null;
}

/**
 * Moves the screen reader's focus to the element given the returned ref, whenever `key` changes (and
 * on the first render unless `initial` is false): for a part of a screen that replaces another (an
 * edit form, the next checklist item), so the focus never stays on a control that went away. Does
 * nothing without a screen reader.
 */
export function useFocusOn<T>(key: unknown, options: { initial?: boolean } = {}) {
  const ref = useRef<T | null>(null);
  const first = useRef(true);
  const { initial = true } = options;
  useEffect(() => {
    const isFirst = first.current;
    first.current = false;
    if (isFirst && !initial) return undefined;
    const t = setTimeout(() => {
      if (!ref.current) return;
      try {
        AccessibilityInfo.sendAccessibilityEvent(ref.current as never, 'focus');
      } catch {
        // No screen reader support (tests, web).
      }
    }, 250);
    return () => clearTimeout(t);
  }, [key]);
  return ref;
}
