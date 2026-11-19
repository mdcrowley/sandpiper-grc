// Settings shared by every kind of sign-in provider: role mapping and just-in-time accounts.
// Both are OFF unless an administrator switches them on.
import type { CommonProviderConfig, RoleMapping } from './types.ts';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function cleanCommonConfig(
  input: Record<string, unknown>, existing: Record<string, any> | null,
): { config: CommonProviderConfig; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const pick = <T>(k: string, fallback: T): T => (input[k] !== undefined ? input[k] : existing?.[k] !== undefined ? existing[k] : fallback) as T;

  const flag = (k: string) => {
    const v = pick<unknown>(k, false);
    if (typeof v !== 'boolean') fields[k] = 'Choose on or off.';
    return v === true;
  };
  const mappingEnabled = flag('mappingEnabled');
  const jitEnabled = flag('jitEnabled');
  const trustEmail = flag('trustEmail');

  const rawMappings = pick<unknown>('mappings', []);
  const mappings: RoleMapping[] = [];
  if (!Array.isArray(rawMappings) || rawMappings.length > 100) fields.mappings = 'Give up to 100 mapping rules.';
  else {
    for (const m of rawMappings) {
      const value = String((m as any)?.value ?? '').trim();
      const role = String((m as any)?.role ?? '').trim();
      if (!value || value.length > 256 || !/^[a-z0-9_]{1,64}$/.test(role)) {
        fields.mappings = 'Each rule needs a group value (up to 256 characters) and a role.';
        break;
      }
      if (!mappings.some((x) => x.value === value && x.role === role)) mappings.push({ value, role });
    }
  }
  if (mappingEnabled && !mappings.length) fields.mappings = 'Add at least one rule, or switch role mapping off.';

  const rawDomains = pick<unknown>('jitDomains', []);
  const jitDomains: string[] = [];
  if (!Array.isArray(rawDomains) || rawDomains.length > 50) fields.jitDomains = 'List up to 50 email domains.';
  else {
    for (const d of rawDomains) {
      const domain = String(d ?? '').trim().toLowerCase().replace(/^@/, '');
      if (!domain) continue;
      if (!DOMAIN_RE.test(domain)) { fields.jitDomains = `"${domain}" is not an email domain, such as example.org.`; break; }
      if (!jitDomains.includes(domain)) jitDomains.push(domain);
    }
  }
  if (jitEnabled && !jitDomains.length) fields.jitDomains = 'Name at least one email domain whose people may get an account, or switch this off.';

  return { config: { mappingEnabled, mappings, jitEnabled, jitDomains, trustEmail }, fields };
}

/** Whether an email's domain is one of the allowed ones (exact match; subdomains must be listed). */
export function domainAllowed(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at < 1) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}
