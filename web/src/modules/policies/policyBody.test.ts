import { describe, expect, it } from 'vitest';
import { wrapPolicyTables } from './policyTables';

describe('policy text tables (E22-48)', () => {
  it('puts each table in its own scroll box', () => {
    const html = '<p>Intro</p><table><tr><td>a</td></tr></table><table class="x"><tr><td>b</td></tr></table>';
    expect(wrapPolicyTables(html)).toBe('<p>Intro</p><div class="pol-table-wrap"><table><tr><td>a</td></tr></table></div>'
      + '<div class="pol-table-wrap"><table class="x"><tr><td>b</td></tr></table></div>');
  });

  it('leaves text without tables alone', () => {
    expect(wrapPolicyTables('<p>tablet</p>')).toBe('<p>tablet</p>');
  });
});
