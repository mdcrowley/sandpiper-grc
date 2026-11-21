import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES } from './templates.ts';

// A template's description names the button that sends it as the screen labels it (docs review F4).
describe('email template descriptions', () => {
  it('name buttons that exist on the screens', () => {
    const screen = readFileSync(new URL('../../../../web/src/modules/notifications/EmailSettings.tsx', import.meta.url), 'utf8');
    for (const t of DEFAULT_TEMPLATES) {
      for (const [, label] of (t.description ?? '').matchAll(/"([^"]+)" button/g)) {
        expect(screen, `${t.key}: "${label}"`).toContain(`>${label}</Button>`);
      }
    }
    expect(DEFAULT_TEMPLATES.find((t) => t.key === 'test')?.description).toBe('Sent by the "Send a test message" button.');
  });
});
