// Administration > Organization (E14-35): the organization's names, address and contacts, the
// application name, its logos and its brand colors. The text and colors are settings, saved
// together through PATCH /api/admin/settings (each change audited); logos upload and are removed
// at once through their own routes. The colors are previewed as the server will apply them: it
// works out a shade of each for the light and the dark theme that meets WCAG 2.2 AA
// (server/src/core/branding-colors.ts) and the preview shows exactly those shades.
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Loading, PageHeader, TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import { Notice } from './common';
import { adminApi } from './reauth';
import { Group, Setting } from './Settings';

type Variant = 'light' | 'dark';
interface LogoMeta { type: string; width: number; height: number; bytes: number; hash: string; filename: string; updatedAt: string }
interface Check { theme: Variant; what: string; foreground: string; background: string; ratio: number; min: number; pass: boolean }
interface Colors { primary: string; accent: string; light: Record<string, string>; dark: Record<string, string>; checks: Check[]; notes: string[] }
interface OrgResponse {
  values: Record<string, string>;
  logos: Record<Variant, LogoMeta | null>;
  limits: { maxBytes: number; maxPixels: number; minPixels: number; types: string[] };
  colors: Colors;
  branding: { logo: { light: string | null; dark: string | null } };
}

/** Each text field: its setting key, label, longest length and hint. */
const FIELDS: Record<string, { label: string; max: number; hint?: string; type?: 'text' | 'email' | 'tel' | 'url'; autoComplete?: string }> = {
  'organization.name': { label: 'Organization name', max: 120, hint: 'How the organization is usually named, such as Example Transit Authority. Shown on the sign-in page, in emails and on printed documents.', autoComplete: 'organization' },
  'organization.legal_name': { label: 'Legal name', max: 200, hint: 'The registered name, when it differs. Printed in email and PDF footers.' },
  'organization.short_name': { label: 'Short name', max: 20, hint: 'An abbreviation, such as ETA.' },
  'organization.city': { label: 'City', max: 80, autoComplete: 'address-level2' },
  'organization.region': { label: 'State or region', max: 80, autoComplete: 'address-level1' },
  'organization.postal_code': { label: 'Postal code', max: 20, autoComplete: 'postal-code' },
  'organization.country': { label: 'Country', max: 80, autoComplete: 'country-name' },
  'organization.phone': { label: 'Main phone', max: 40, type: 'tel', autoComplete: 'tel', hint: 'Digits, spaces, + ( ) - and an optional extension.' },
  'organization.email': { label: 'General email', max: 254, type: 'email', autoComplete: 'email' },
  'organization.website': { label: 'Website', max: 200, type: 'url', autoComplete: 'url', hint: 'Such as https://www.example.org.' },
  'organization.security_phone': { label: 'Security contact phone', max: 40, type: 'tel', hint: 'Never shown before sign-in.' },
  'organization.security_email': { label: 'Security contact email', max: 254, type: 'email', hint: 'Never shown before sign-in.' },
};
const KEYS = ['app.name', 'organization.street', ...Object.keys(FIELDS), 'branding.primary_color', 'branding.accent_color'];
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const DEFAULT_PRIMARY = '#17656f';
const DEFAULT_ACCENT = '#b9782a';

const GROUPS = [
  { id: 'names', title: 'Names' }, { id: 'address', title: 'Address' }, { id: 'contacts', title: 'Contacts' },
  { id: 'logo', title: 'Logo' }, { id: 'colors', title: 'Colors' },
];

/** `#abc` -> `#aabbcc`, or '' when it is not a color. */
function fullHex(v: string): string {
  const m = HEX.exec(v.trim());
  if (!m) return '';
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

/** Checks the browser can make before saving; the server checks again. */
function localProblems(form: Record<string, string>): Record<string, string> {
  const found: Record<string, string> = {};
  const name = (form['app.name'] ?? '').trim();
  if (name.length < 1 || name.length > 60) found['app.name'] = 'Enter a name of 1 to 60 characters.';
  for (const [key, f] of Object.entries(FIELDS)) {
    if ((form[key] ?? '').trim().length > f.max) found[key] = `${f.label} can be up to ${f.max} characters.`;
  }
  const lines = (form['organization.street'] ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length > 3) found['organization.street'] = 'Street can have up to three lines.';
  else if (lines.some((l) => l.length > 120)) found['organization.street'] = 'Each street line can be up to 120 characters.';
  for (const [key, what] of [['branding.primary_color', 'Brand color'], ['branding.accent_color', 'Accent color']]) {
    if (form[key] && !fullHex(form[key])) found[key] = `${what}: enter a color as six hexadecimal digits, such as #17656f.`;
  }
  return found;
}

export function OrganizationPage() {
  const toast = useToast();
  const auth = useAuth();
  const { data, error, reload } = useFetch<OrgResponse>('/api/admin/organization');
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setForm(Object.fromEntries(KEYS.map((k) => [k, String(data.values[k] ?? '')]))); }, [data]);
  // Other pages link to a section (/admin/organization#settings-logo): go there once the page is drawn.
  const ready = Boolean(data && form);
  useEffect(() => {
    if (!ready || !window.location.hash.startsWith('#settings-')) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [ready]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !form) return <Loading lines={10} label="Loading organization" />;

  const start = Object.fromEntries(KEYS.map((k) => [k, String(data.values[k] ?? '')]));
  const isChanged = (k: string) => (form[k] ?? '') !== (start[k] ?? '');
  const changed = KEYS.filter(isChanged);
  const set = (key: string, value: string) => {
    setForm({ ...form, [key]: value });
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
  };
  const field = (key: string) => {
    const f = FIELDS[key];
    return (
      <TextField
        label={f.label} value={form[key]} onChange={(v) => set(key, v)} error={errors[key]} hint={f.hint}
        maxLength={f.max} type={f.type} autoComplete={f.autoComplete}
      />
    );
  };

  const save = async () => {
    const found = localProblems(form);
    setErrors(found);
    if (Object.keys(found).length) { toast.error('Check the highlighted fields.'); return; }
    setBusy(true);
    try {
      await adminApi.patch('/api/admin/settings', Object.fromEntries(changed.map((k) => [k, k.startsWith('branding.') ? fullHex(form[k]) : form[k]])));
      toast.success('Organization saved.');
      reload();
      await auth.refresh(); // the new name, colors and logo apply at once
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      toast.error(Object.keys(fields).length ? 'Nothing was saved. Check the highlighted fields.' : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const problems = Object.keys(errors).length;
  // Text that names optional parts is written from the switches (Administration > Features).
  const kitOn = auth.areaOn('secincidents');
  const logoPlaces = ['in the header and sidebar', 'on the sign-in page', auth.areaOn('portal') && 'in the self-service portal',
    auth.areaOn('vendors') && 'on the vendor response page', 'as the browser tab icon', 'on PDF documents'].filter(Boolean) as string[];

  return (
    <>
      <PageHeader
        title="Organization"
        subtitle="Who the organization is and how the application looks for it. Every change is recorded in the audit log."
        actions={<>
          {changed.length > 0 && <span className="adm-unsaved" role="status">{changed.length} unsaved {changed.length === 1 ? 'change' : 'changes'}</span>}
          <Button disabled={changed.length === 0} onClick={() => { setForm(start); setErrors({}); }}>Undo changes</Button>
          <Button variant="primary" disabled={changed.length === 0} loading={busy} onClick={() => void save()}>Save organization</Button>
        </>}
      />
      <div className="adm-settings">
        <nav className="adm-settings-nav" aria-label="Organization sections">
          {GROUPS.map((g) => (
            <a key={g.id} href={`#settings-${g.id}`} onClick={(e) => { e.preventDefault(); const el = document.getElementById(`settings-${g.id}`); el?.scrollIntoView({ block: 'start' }); el?.focus(); }}>{g.title}</a>
          ))}
        </nav>
        <div className="adm-settings-body">
          {problems > 0 && <p className="form-error" role="alert">{problems} {problems === 1 ? 'field needs' : 'fields need'} attention. Nothing has been saved.</p>}

          <Group id="names" title="Names" text="What the organization and the application are called.">
            <Card>
              <Setting title="Application name" changed={isChanged('app.name')} error={errors['app.name']} text="Shown on the sign-in page, in the header, in the browser tab, in emails and as the account name in authenticator apps. Up to 60 characters.">
                <TextField label="Application name" hideLabel maxLength={60} value={form['app.name']} onChange={(v) => set('app.name', v)} error={errors['app.name']} />
              </Setting>
              <Setting title="Organization" changed={['organization.name', 'organization.legal_name', 'organization.short_name'].some(isChanged)} text="The organization's names. Any may be left empty; where no name is set, the application name is used.">
                {field('organization.name')}
                {field('organization.legal_name')}
                {field('organization.short_name')}
              </Setting>
            </Card>
          </Group>

          <Group id="address" title="Address" text="The postal address, printed in the footer of emails and PDF documents. Write it the way it is written where the organization is; nothing here assumes a country.">
            <Card>
              <Setting title="Postal address" changed={['organization.street', 'organization.city', 'organization.region', 'organization.postal_code', 'organization.country'].some(isChanged)} text="Up to three street lines, then the city, state or region, postal code and country. Every part is optional.">
                <TextArea label="Street" rows={3} maxRows={3} value={form['organization.street']} onChange={(v) => set('organization.street', v)} error={errors['organization.street']} hint="Up to three lines of up to 120 characters." />
                {field('organization.city')}
                {field('organization.region')}
                {field('organization.postal_code')}
                {field('organization.country')}
              </Setting>
            </Card>
          </Group>

          <Group id="contacts" title="Contacts" text={kitOn ? 'How to reach the organization. The general ones are printed in email and PDF footers; the security contact only in the offline incident kit.' : 'How to reach the organization, printed in email and PDF footers.'}>
            <Card>
              <Setting title="General" changed={['organization.phone', 'organization.email', 'organization.website'].some(isChanged)} text="The main phone number, a general email address and the website.">
                {field('organization.phone')}
                {field('organization.email')}
                {field('organization.website')}
              </Setting>
              {kitOn && (
                <Setting title="Security incidents" changed={['organization.security_phone', 'organization.security_email'].some(isChanged)} text="Optional. Who to contact about a security incident, for the offline incident kit. Only administrators see these here.">
                  {field('organization.security_phone')}
                  {field('organization.security_email')}
                </Setting>
              )}
            </Card>
          </Group>

          <Group id="logo" title="Logo" text={`Shown in place of the standard mark: ${logoPlaces.slice(0, -1).join(', ')} and ${logoPlaces[logoPlaces.length - 1]}. A logo is saved as soon as it is uploaded.`}>
            <Card>
              <LogoSetting variant="light" data={data} onDone={() => { reload(); void auth.refresh(); }} />
              <LogoSetting variant="dark" data={data} onDone={() => { reload(); void auth.refresh(); }} />
            </Card>
          </Group>

          <Group id="colors" title="Colors" text="The brand color fills buttons and the header and colors links; the accent marks the current page in the sidebar and highlights. Saved with the rest of the page.">
            <ColorSettings form={form} set={set} errors={errors} isChanged={isChanged} logo={data.branding.logo} appName={form['app.name'] || auth.appName} />
          </Group>
        </div>
      </div>
    </>
  );
}

const THEME_TEXT: Record<Variant, { title: string; text: string; bg: string }> = {
  light: { title: 'Logo for the light theme', text: 'Used everywhere unless a dark-theme logo is set.', bg: '#ffffff' },
  dark: { title: 'Logo for the dark theme', text: 'Optional. Used in the dark theme and in the sidebar, which is dark in both themes. Without one, the light-theme logo is used there too.', bg: '#151e21' },
};

/** Reads a picked file as base64 (without the data: prefix). */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
}

function LogoSetting({ variant, data, onDone }: { variant: Variant; data: OrgResponse; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [problem, setProblem] = useState('');
  const meta = data.logos[variant];
  const src = variant === 'light' ? data.branding.logo.light : meta ? data.branding.logo.dark : null;
  const { limits } = data;
  const words = THEME_TEXT[variant];

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setProblem('');
    if (file.size > limits.maxBytes) { setProblem(`The file is ${Math.ceil(file.size / 1024)} KB; a logo can be up to ${limits.maxBytes / 1024} KB.`); return; }
    setBusy('upload');
    try {
      await api.post(`/api/admin/organization/logo/${variant}`, { data: await readBase64(file), filename: file.name });
      toast.success(`${words.title} saved.`);
      onDone();
    } catch (err) {
      setProblem(err instanceof ApiError && err.fields.data ? err.fields.data : errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy('remove');
    setProblem('');
    try {
      await api.del(`/api/admin/organization/logo/${variant}`);
      toast.success(`${words.title} removed.`);
      onDone();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Setting
      title={words.title} error={problem}
      text={<>{words.text} PNG, JPEG or WebP (not SVG), up to {limits.maxBytes / 1024} KB and {limits.maxPixels} pixels each way. A logo about four times as wide as it is tall, with a see-through background, fits best. PDF documents take PNG or JPEG only.</>}
    >
      <div className="adm-logo-preview" style={{ background: words.bg }}>
        {src
          ? <img src={src} alt={`Current ${words.title.toLowerCase()}`} />
          : <span style={{ color: variant === 'dark' ? '#d5e2e4' : '#50626a' }}>{variant === 'dark' && data.logos.light ? 'Using the light-theme logo' : 'Standard mark'}</span>}
      </div>
      {meta && <p className="field-hint">{meta.filename || 'Logo'} · {meta.width} × {meta.height} pixels · {Math.ceil(meta.bytes / 1024)} KB</p>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pick(e)} aria-label={`Choose a ${words.title.toLowerCase()}`} />
      <div className="row">
        <Button icon="upload" loading={busy === 'upload'} onClick={() => input.current?.click()}>{meta ? 'Replace' : 'Upload logo'}</Button>
        {meta && <Button variant="danger" loading={busy === 'remove'} onClick={() => void remove()}>Remove</Button>}
      </div>
    </Setting>
  );
}

interface ColorProps {
  form: Record<string, string>;
  set: (key: string, value: string) => void;
  errors: Record<string, string>;
  isChanged: (key: string) => boolean;
  logo: { light: string | null; dark: string | null };
  appName: string;
}

function ColorSettings({ form, set, errors, isChanged, logo, appName }: ColorProps) {
  const primary = fullHex(form['branding.primary_color']);
  const accent = fullHex(form['branding.accent_color']);
  const [colors, setColors] = useState<Colors | null>(null);
  const [previewError, setPreviewError] = useState('');
  // Ask the server what the colors become in each theme (debounced while typing).
  useEffect(() => {
    if ((form['branding.primary_color'] && !primary) || (form['branding.accent_color'] && !accent)) return;
    let live = true;
    const t = window.setTimeout(() => {
      api.post<Colors>('/api/admin/organization/colors', { primary, accent })
        .then((c) => { if (live) { setColors(c); setPreviewError(''); } })
        .catch((err) => { if (live) setPreviewError(errorMessage(err)); });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [primary, accent, form]);

  const colorRow = (key: string, label: string, fallback: string) => (
    <div className="adm-color-row">
      <input
        type="color" className="adm-color-swatch" aria-label={`${label}: pick a color`}
        value={fullHex(form[key]) || fallback} onChange={(e) => set(key, e.currentTarget.value)}
      />
      <TextField label={label} value={form[key]} onChange={(v) => set(key, v)} error={errors[key]} placeholder={`Standard (${fallback})`} maxLength={7} hint="Six hexadecimal digits, such as #17656f. Empty for the standard color." />
    </div>
  );
  const failing = colors?.checks.filter((c) => !c.pass) ?? [];

  return (
    <Card>
      <Setting title="Brand and accent colors" changed={isChanged('branding.primary_color') || isChanged('branding.accent_color')} text="Pick any colors. Each theme gets its own shade of them that keeps text readable (WCAG 2.2 AA: 4.5 to 1 for text, 3 to 1 for marks), so the colors may be made darker for the light theme and lighter for the dark theme.">
        {colorRow('branding.primary_color', 'Brand color', DEFAULT_PRIMARY)}
        {colorRow('branding.accent_color', 'Accent color', DEFAULT_ACCENT)}
        <div className="row">
          <Button disabled={!form['branding.primary_color'] && !form['branding.accent_color']} onClick={() => { set('branding.primary_color', ''); set('branding.accent_color', ''); }}>Reset to default</Button>
        </div>
      </Setting>
      <div className="adm-color-preview-wrap">
        <h3 className="adm-color-preview-title">Preview</h3>
        {previewError && <p className="form-error" role="alert">{previewError}</p>}
        {!colors ? <Loading lines={2} label="Working out the shades" /> : (
          <>
            <div className="adm-color-previews">
              <ThemePreview theme="light" tokens={colors.light} logo={logo.dark ?? logo.light} appName={appName} />
              <ThemePreview theme="dark" tokens={colors.dark} logo={logo.dark ?? logo.light} appName={appName} />
            </div>
            {colors.notes.length > 0 && <Notice tone="info">{colors.notes.join(' ')}</Notice>}
            <details className="adm-color-checks">
              <summary>{failing.length === 0 ? `All ${colors.checks.length} contrast checks pass` : `${failing.length} of ${colors.checks.length} contrast checks fail`}</summary>
              <div className="table-wrap"><table className="table">
                <thead><tr><th scope="col">Theme</th><th scope="col">What</th><th scope="col">Colors</th><th scope="col">Contrast</th></tr></thead>
                <tbody>
                  {colors.checks.map((c) => (
                    <tr key={`${c.theme}-${c.what}`}>
                      <td>{c.theme === 'light' ? 'Light' : 'Dark'}</td>
                      <td>{c.what}</td>
                      <td><code>{c.foreground}</code> on <code>{c.background}</code></td>
                      <td>{c.ratio.toFixed(2)} to 1 (needs {c.min}) {c.pass ? 'passes' : 'fails'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </details>
          </>
        )}
      </div>
    </Card>
  );
}

const SURFACE: Record<Variant, { bg: string; surface: string; text: string; navText: string }> = {
  light: { bg: '#f3f6f6', surface: '#ffffff', text: '#14252b', navText: '#d5e2e4' },
  dark: { bg: '#0d1416', surface: '#151e21', text: '#e4ecee', navText: '#d5e2e4' },
};

/** The header, a button and a link drawn with one theme's shades, whatever theme the page is in. */
function ThemePreview({ theme, tokens, logo, appName }: { theme: Variant; tokens: Record<string, string>; logo: string | null; appName: string }) {
  const s = SURFACE[theme];
  const box: CSSProperties = { background: s.surface, color: s.text, borderColor: theme === 'dark' ? '#2a383d' : '#dbe3e5' };
  return (
    <figure className="adm-color-preview" style={box} aria-label={`${theme === 'light' ? 'Light' : 'Dark'} theme preview`}>
      <div className="adm-color-preview-bar" style={{ background: tokens['--nav-bg'], color: s.navText }}>
        {logo ? <img src={logo} alt="" /> : <span className="adm-color-preview-mark" style={{ background: tokens['--logo-bg'], borderColor: tokens['--logo-accent'] }} />}
        <strong>{appName}</strong>
        <span className="adm-color-preview-current" style={{ borderColor: tokens['--nav-accent'] }}>Overview</span>
      </div>
      <div className="adm-color-preview-body" style={{ background: s.bg }}>
        <span className="adm-color-preview-button" style={{ background: tokens['--brand'], color: tokens['--brand-contrast'] }}>Save</span>
        <span className="adm-color-preview-soft" style={{ background: tokens['--brand-soft'], color: tokens['--link'] }}>Filter</span>
        <span style={{ color: tokens['--link'], textDecoration: 'underline' }}>A link to a record</span>
      </div>
      <figcaption>{theme === 'light' ? 'Light theme' : 'Dark theme'}</figcaption>
    </figure>
  );
}
