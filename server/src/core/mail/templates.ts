// Message templates: data, edited by administrators (Administration > Email > Templates).
//
// A template has a subject, a plain-text body and a simple HTML body, with placeholders such as
// {{title}}. Each template accepts only its own placeholders. Values are inserted as they are in
// the text body and subject (line breaks removed from the subject), and HTML-escaped in the
// HTML body; `items` (the digest list) is built by the application in both forms. The HTML may
// use only a few plain tags, and a link may point only at a placeholder link, https: or mailto:.

export interface TemplateDef {
  key: string;
  name: string;
  description: string;
  placeholders: string[];
  subject: string;
  text: string;
}

/**
 * Placeholders every template accepts. The organization's ones come from Administration >
 * Organization (core/organization.ts); each is empty when it is not set.
 */
const COMMON = ['appName', 'recipientName', 'organizationName', 'organizationAddress', 'organizationPhone', 'organizationEmail', 'organizationWebsite'];

export const DEFAULT_TEMPLATES: TemplateDef[] = [
  {
    key: 'test', name: 'Test message', description: 'Sent by the "Send test email" button.',
    placeholders: [...COMMON, 'senderName', 'link'],
    subject: 'Test message from {{appName}}',
    text: 'This is a test message from {{appName}}, sent by {{senderName}}.\n\nIf you can read it, email delivery works.\n\n{{link}}',
  },
  {
    key: 'notification', name: 'Notification', description: 'One notification, for people who receive their notifications by email.',
    placeholders: [...COMMON, 'title', 'body', 'kindLabel', 'link', 'preferencesLink'],
    subject: '{{title}}',
    text: 'Hello {{recipientName}},\n\n{{title}}\n{{body}}\n\nOpen it in {{appName}}:\n{{link}}\n\nYou receive this because of your notification preferences ({{kindLabel}}). Change them here:\n{{preferencesLink}}',
  },
  {
    key: 'notification_restricted', name: 'Security notification',
    description: 'Sent instead of the notification when the record is restricted. It must not name or describe the record.',
    placeholders: [...COMMON, 'link', 'preferencesLink'],
    subject: 'New security notification in {{appName}}',
    text: 'Hello {{recipientName}},\n\nYou have a new security notification — open the application to view it.\n\n{{link}}\n\nChange your notification preferences here:\n{{preferencesLink}}',
  },
  {
    key: 'digest', name: 'Daily summary', description: 'One message a day listing new notifications, for people who chose the daily summary.',
    placeholders: [...COMMON, 'count', 'items', 'link', 'preferencesLink'],
    subject: 'Your daily summary from {{appName}}: {{count}} new',
    text: 'Hello {{recipientName}},\n\nHere is what has arrived since your last summary:\n\n{{items}}\n\nSee all your notifications:\n{{link}}\n\nChange your notification preferences here:\n{{preferencesLink}}',
  },
  {
    key: 'setup_link', name: 'Account set-up link', description: 'Sent when an administrator creates an account or issues a new set-up link.',
    placeholders: [...COMMON, 'username', 'link', 'expiresAt'],
    subject: 'Set your password for {{appName}}',
    text: 'Hello {{recipientName}},\n\nAn account has been created for you in {{appName}}. Your username is {{username}}.\n\nSet your password with this link. It works once and expires {{expiresAt}}:\n{{link}}\n\nIf you were not expecting this message, you can ignore it.',
  },
  {
    key: 'reset_link', name: 'Password reset link', description: 'Sent when someone asks to reset their password, or an administrator issues a reset link.',
    placeholders: [...COMMON, 'username', 'link', 'expiresAt'],
    subject: 'Reset your password for {{appName}}',
    text: 'Hello {{recipientName}},\n\nA password reset was requested for your {{appName}} account ({{username}}).\n\nChoose a new password with this link. It works once and expires {{expiresAt}}:\n{{link}}\n\nIf you did not ask for this, ignore this message: your password has not changed.',
  },
  {
    key: 'message', name: 'General message', description: 'Used by other parts of the application (scheduled reports, alerts) for their own messages.',
    placeholders: [...COMMON, 'subject', 'message', 'link'],
    subject: '{{subject}}',
    text: 'Hello {{recipientName}},\n\n{{message}}\n\n{{link}}',
  },
  {
    key: 'text_message', name: 'Text message (email-to-text)',
    description: 'A short alert sent to a person\'s email-to-text address, which their phone receives as a text message. Keep it short: many services cut a text at 160 characters.',
    placeholders: [...COMMON, 'message'],
    subject: '{{appName}}',
    text: '{{message}}',
  },
  {
    key: 'vendor_response_link', name: 'Vendor response link',
    description: 'Sent to a vendor contact with the link to answer an assessment\'s questions (Vendors > assessment > Response link > Email it to).',
    placeholders: [...COMMON, 'organization', 'vendorName', 'assessmentTitle', 'expiresAt', 'link'],
    subject: '{{organization}}: assessment questions for {{vendorName}}',
    text: 'Hello,\n\n{{organization}} asks {{vendorName}} to answer the questions of its assessment "{{assessmentTitle}}".\n\n'
      + 'Open the link below to answer. No account is needed. You can save your answers and come back before you send them, and send supporting files such as certificates or reports if the page offers it. The link works until {{expiresAt}}.\n\n'
      + '{{link}}\n\nThe link is meant for you: please do not forward it. If you were not expecting this message, you can ignore it.',
  },
  {
    key: 'vendor_response_reminder', name: 'Vendor response link reminder',
    description: 'Sent once to the vendor contact before an emailed response link expires while the answers have not been sent. It cannot carry the link.',
    placeholders: [...COMMON, 'organization', 'vendorName', 'assessmentTitle', 'expiresAt', 'sentAt'],
    subject: 'Reminder: {{organization}} assessment questions for {{vendorName}}',
    text: 'Hello,\n\nOn {{sentAt}}, {{organization}} sent you a link to answer the questions of its assessment "{{assessmentTitle}}" for {{vendorName}}. '
      + 'The answers have not been sent yet, and the link stops working {{expiresAt}}.\n\n'
      + 'Use the link in that earlier message. If you can no longer find it, ask your contact for a new one.',
  },
];

export const LINK_PLACEHOLDERS = ['link', 'preferencesLink'];
/** Built by the application in both forms, not escaped again. */
const BLOCKS = ['items'];

export const escapeHtml = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The default HTML body: paragraphs from the text, and a line that is only a link becomes a link. */
export function textToHtml(text: string): string {
  return text.split(/\n{2,}/).map((para) => {
    const lines = para.split('\n').map((line) => {
      const m = /^\{\{(link|preferencesLink)\}\}$/.exec(line.trim());
      if (m) return `<a href="{{${m[1]}}}">{{${m[1]}}}</a>`;
      return line;
    });
    if (lines.length === 1 && lines[0] === '{{items}}') return '{{items}}';
    return `<p>${lines.join('<br>')}</p>`;
  }).join('\n');
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'a', 'hr', 'div', 'span', 'blockquote']);

export const placeholdersIn = (s: string) => [...s.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);

/** Field messages for a template edit, empty when it is acceptable. */
export function validateTemplate(def: TemplateDef, t: { subject: string; text: string; html: string }): Record<string, string> {
  const fields: Record<string, string> = {};
  const allowed = new Set(def.placeholders);
  const unknown = (s: string) => [...new Set(placeholdersIn(s).filter((p) => !allowed.has(p)))];
  if (!t.subject.trim() || t.subject.length > 200 || /[\r\n]/.test(t.subject)) fields.subject = 'Enter a subject of one line, up to 200 characters.';
  else if (unknown(t.subject).length) fields.subject = `Unknown placeholder: ${unknown(t.subject).join(', ')}.`;
  else if (placeholdersIn(t.subject).some((p) => BLOCKS.includes(p))) fields.subject = 'The list of items cannot go in the subject.';
  if (!t.text.trim() || t.text.length > 10000) fields.text = 'Enter a plain-text body of up to 10,000 characters.';
  else if (unknown(t.text).length) fields.text = `Unknown placeholder: ${unknown(t.text).join(', ')}.`;
  if (t.html.length > 20000) fields.html = 'Keep the HTML body under 20,000 characters.';
  else if (unknown(t.html).length) fields.html = `Unknown placeholder: ${unknown(t.html).join(', ')}.`;
  else {
    const problem = htmlProblem(t.html);
    if (problem) fields.html = problem;
  }
  // The restricted-record message must stay content-free.
  if (def.key === 'notification_restricted' && !fields.text && /\{\{\s*(title|body)\s*\}\}/.test(t.text + t.html + t.subject)) {
    fields.text = 'This message must not include the title or text of the notification.';
  }
  return fields;
}

function htmlProblem(html: string): string | null {
  if (/<!--|<!\[|<\?/.test(html)) return 'Comments and processing instructions are not allowed in the HTML body.';
  const rest = html.replace(/<\/?([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+\s*=\s*"[^"<>]*")*)\s*\/?>/g, (whole, tag: string, attrs: string) => {
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return `\u0000tag:${name}\u0000`;
    for (const m of attrs.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) {
      const attr = m[1].toLowerCase();
      const value = m[2].trim();
      if (name !== 'a' || attr !== 'href') return `\u0000attr:${attr}\u0000`;
      if (!/^\{\{\s*(link|preferencesLink)\s*\}\}$/.test(value) && !/^(https:\/\/|mailto:)[^\s]*$/i.test(value)) return '\u0000href\u0000';
    }
    return '';
  });
  const bad = /\u0000(tag|attr):([^\u0000]+)\u0000/.exec(rest);
  if (bad) return bad[1] === 'tag' ? `The tag <${bad[2]}> is not allowed. Use simple tags such as p, br, strong, em, ul, li and a.` : `The attribute "${bad[2]}" is not allowed; only href on links.`;
  if (rest.includes('\u0000href\u0000')) return 'A link may point only at {{link}}, {{preferencesLink}}, an https: address or a mailto: address.';
  if (/[<>]/.test(rest)) return 'The HTML body has a tag that could not be read. Write tags such as <p>, <strong> and <a href="{{link}}">.';
  return null;
}

export interface Rendered { subject: string; text: string; html: string }

/**
 * The organization around a message (Administration > Organization): its name above the HTML body
 * and its name, address and contacts under both bodies. Left out of text messages.
 */
export interface MailFrame {
  name: string; footer: string[]; color?: string | null;
  /**
   * The organization's logo above the HTML body (E14-36): a picture carried inside the message
   * and named by its Content-ID, so mail programs show it without loading anything from outside.
   * The caller attaches the picture with that Content-ID. The text body is unchanged.
   */
  logo?: { cid: string; width: number; height: number } | null;
}

/**
 * Fills a template. `values` are plain strings; `blocks.items` is the digest list as
 * `{ text, html }`. Link values that are not http(s) addresses are dropped.
 */
export function render(
  t: { subject: string; text_body: string; html_body: string },
  values: Record<string, string | number | null | undefined>,
  blocks: Record<string, { text: string; html: string }> = {},
  frame: MailFrame | null = null,
): Rendered {
  const value = (name: string) => {
    const v = values[name];
    const s = v === null || v === undefined ? '' : String(v);
    if (LINK_PLACEHOLDERS.includes(name) && s && !/^https?:\/\//i.test(s)) return '';
    return s;
  };
  const fill = (s: string, mode: 'subject' | 'text' | 'html') => s.replace(PLACEHOLDER_RE, (_m, name: string) => {
    if (BLOCKS.includes(name)) return mode === 'html' ? blocks[name]?.html ?? '' : mode === 'text' ? blocks[name]?.text ?? '' : '';
    const v = value(name);
    if (mode === 'subject') return v.replace(/[\r\n]+/g, ' ');
    return mode === 'html' ? escapeHtml(v) : v;
  });
  const footer = (frame?.footer ?? []).map((l) => l.replace(/[\r\n]+/g, ' ').trim()).filter(Boolean);
  const body = fill(t.text_body, 'text').replace(/\n{3,}/g, '\n\n').trim();
  const text = footer.length ? `${body}\n\n-- \n${footer.join('\n')}` : body;
  const htmlBody = t.html_body.trim() ? t.html_body : textToHtml(t.text_body);
  const color = frame?.color && /^#[0-9a-f]{6}$/i.test(frame.color) ? frame.color : '#17656f';
  const logo = frame?.logo && /^[A-Za-z0-9.@_-]{1,100}$/.test(frame.logo.cid) ? frame.logo : null;
  const size = (n: number) => Math.max(1, Math.min(400, Math.round(Number(n) || 1)));
  // With a logo, the name is its alternative text (shown where pictures are switched off).
  const head = logo
    ? `<p style="margin: 0 0 16px;"><img src="cid:${logo.cid}" width="${size(logo.width)}" height="${size(logo.height)}" alt="${escapeHtml(frame?.name ?? '')}" style="display: block; border: 0; width: ${size(logo.width)}px; height: ${size(logo.height)}px;"></p>\n`
    : frame?.name ? `<p style="margin: 0 0 16px; font-weight: 600; font-size: 16px; color: ${color};">${escapeHtml(frame.name)}</p>\n` : '';
  const foot = footer.length
    ? `\n<hr style="border: 0; border-top: 1px solid #d5dde0; margin: 24px 0 12px;">\n<p style="margin: 0; font-size: 12px; color: #50626a;">${footer.map(escapeHtml).join('<br>')}</p>`
    : '';
  const html = `<!doctype html><html><body style="font-family: system-ui, sans-serif; font-size: 15px; line-height: 1.5; color: #1a1f2b;">\n${head}${fill(htmlBody, 'html')}${foot}\n</body></html>`;
  return { subject: fill(t.subject, 'subject').replace(/\s+/g, ' ').trim().slice(0, 250) || '(no subject)', text, html };
}
