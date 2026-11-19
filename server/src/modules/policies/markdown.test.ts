import { describe, expect, it } from 'vitest';
import { isSafeHref, renderPolicyMarkdown, sanitiseHtml } from './markdown.ts';

// Anything that could run code if it reached the page as markup.
// An event-handler attribute on a tag (text inside a quoted attribute value is inert, so values are blanked first).
const HANDLER = /<[^>]*\son[a-z]+\s*=/i;
const blank = (html: string) => html.replace(/"[^"]*"/g, '""');
const DANGEROUS = /<\s*(script|iframe|img|svg|object|embed|style|link|form|meta|base|video|audio|math)\b|(href|src)\s*=\s*"?\s*(javascript|data|vbscript):/i;

describe('safe rendering of policy text', () => {
  it('renders ordinary Markdown', () => {
    const html = renderPolicyMarkdown('## Purpose\n\nUse **strong** passwords.\n\n- one\n- two\n\n| A | B |\n|---|:-:|\n| 1 | 2 |\n\n`code`');
    expect(html).toContain('<h2>Purpose</h2>');
    expect(html).toContain('<strong>strong</strong>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td align="center">2</td>');
    expect(html).toContain('<code>code</code>');
    expect(renderPolicyMarkdown('')).toBe('');
    expect(renderPolicyMarkdown(null)).toBe('');
  });

  it('shows raw HTML as text instead of running it', () => {
    const html = renderPolicyMarkdown('Hello <script>alert(1)</script> world\n\n<div onclick="steal()">box</div>\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toMatch(DANGEROUS);
    expect(blank(html)).not.toMatch(HANDLER);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;div onclick=');
    expect(html).not.toContain('<div');
  });

  it('never lets through script, event handlers or unsafe addresses', () => {
    const attacks = [
      '<script>alert(1)</script>',
      '<SCRIPT SRC=//example.test/x.js></SCRIPT>',
      '<img src=x onerror=alert(1)>',
      '<svg/onload=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<a href="javascript:alert(1)" onclick="alert(2)">x</a>',
      '<p onmouseover="alert(1)">hover</p>',
      '<details open ontoggle=alert(1)>',
      '<style>body{background:url("javascript:alert(1)")}</style>',
      '[click](javascript:alert(1))',
      '[click](JaVaScRiPt:alert(1))',
      '[click](java\tscript:alert(1))',
      '[click](&#106;avascript:alert(1))',
      '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
      '[click](vbscript:msgbox(1))',
      '![alt](javascript:alert(1))',
      '![alt](https://example.test/tracker.png "t")',
      '[x](https://example.test "a\\" onmouseover=\\"alert(1)")',
      '<javascript:alert(1)>',
      '`<script>alert(1)</script>`',
      '```html\n<script>alert(1)</script>\n```',
      '<<script>script>alert(1)<</script>/script>',
      '<a href="https://example.test"\nonclick="alert(1)">x</a>',
      '<input type="text" onfocus="alert(1)" autofocus>',
      '| a |\n|---|\n| <img src=x onerror=alert(1)> |',
      '> <script>alert(1)</script>',
    ];
    for (const attack of attacks) {
      const html = renderPolicyMarkdown(attack);
      expect(html, attack).not.toMatch(DANGEROUS);
      expect(blank(html), attack).not.toMatch(HANDLER);
      // Every tag left in the output is on the allow-list.
      for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) {
        expect(['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
          'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'input'], attack).toContain(m[1].toLowerCase());
      }
      // And the only attributes are the few that are rebuilt.
      for (const m of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
        const attrs = m[0].replace(/^<[a-zA-Z0-9-]+/, '').replace(/"[^"]*"/g, '""');
        for (const a of attrs.matchAll(/([a-zA-Z-]+)(?==|\s|>)/g)) {
          expect(['href', 'title', 'target', 'rel', 'align', 'start', 'type', 'disabled', 'checked'], `${attack} -> ${m[0]}`).toContain(a[1].toLowerCase());
        }
      }
    }
  });

  it('keeps safe links and makes outside links open in a new tab', () => {
    const html = renderPolicyMarkdown('[site](https://example.test/a?b=1&c=2) and [mail](mailto:help@example.test) and [here](/policies) and [top](#purpose)');
    expect(html).toContain('<a href="https://example.test/a?b=1&amp;c=2" target="_blank" rel="noreferrer noopener">site</a>');
    expect(html).toContain('<a href="mailto:help@example.test" target="_blank" rel="noreferrer noopener">mail</a>');
    expect(html).toContain('<a href="/policies">here</a>');
    expect(html).toContain('<a href="#purpose">top</a>');
    // An unsafe link keeps its words but loses the address.
    expect(renderPolicyMarkdown('[words](javascript:alert(1))')).toBe('<p>words</p>\n');
    // Images are never loaded (the application makes no outside requests); the description is kept.
    expect(renderPolicyMarkdown('![Network diagram](https://example.test/d.png)')).toContain('[Image: Network diagram]');
  });

  it('judges addresses the way a browser would', () => {
    expect(isSafeHref('https://example.test')).toBe(true);
    expect(isSafeHref('/policies/1')).toBe(true);
    expect(isSafeHref('//example.test')).toBe(false);
    expect(isSafeHref(' javascript:alert(1)')).toBe(false);
    expect(isSafeHref('java\nscript:alert(1)')).toBe(false);
    expect(isSafeHref('&#x6A;avascript:alert(1)')).toBe(false);
    expect(isSafeHref('javascript&colon;alert(1)')).toBe(false);
    expect(isSafeHref('relative/path')).toBe(false);
    expect(isSafeHref('')).toBe(false);
  });

  it('the second layer alone strips markup the first layer never saw', () => {
    const html = sanitiseHtml('<p onclick="x()">ok</p><script>bad()</script><a href="javascript:x()" title="t">l</a><img src=x><b>bold</b>');
    expect(html).toBe('<p>ok</p>&lt;script&gt;bad()&lt;/script&gt;<a>l</a>&lt;img src=x&gt;&lt;b&gt;bold&lt;/b&gt;');
  });
});
