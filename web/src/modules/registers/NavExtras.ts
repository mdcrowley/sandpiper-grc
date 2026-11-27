// The menu and Create entries of the registers an administrator defines (E41-06). Registers are made
// while the application runs, so their entries cannot be written in index.tsx: the shell asks this
// hook (web/src/core/Shell.tsx, NavExtras.ts of any module) on every render. Each register sits in the
// menu group its administrator chose; switched-off registers and those the person may not open are
// not in the list the server gives.
import { useEffect, useMemo } from 'react';
import { useAuth } from '../../core/auth';
import { useFetch } from '../../core/hooks';
import type { IconName } from '../../core/Icon';
import { navGroupOf, type CreateItem, type NavItem } from '../../core/module';

export interface RegisterSummary {
  key: string;
  type: string;
  label: string;
  plural: string;
  description: string;
  navGroup: string;
  icon: string;
  route: string;
  canCreate: boolean;
}

/** Fired after an administrator defines, changes or removes a register, so the menu reloads. */
export const REGISTERS_CHANGED = 'grc:registers-changed';

/** The registers this person may open (switched-off ones left out). */
export function useRegisters() {
  const { user, features } = useAuth();
  // Read again when a switch changes (Administration > Features).
  const off = Object.entries(features ?? {}).filter(([, on]) => !on).map(([k]) => k).sort().join(',');
  const state = useFetch<RegisterSummary[]>(user ? `/api/registers?off=${encodeURIComponent(off)}` : null, { keepPrevious: true });
  const { reload } = state;
  useEffect(() => {
    window.addEventListener(REGISTERS_CHANGED, reload);
    return () => window.removeEventListener(REGISTERS_CHANGED, reload);
  }, [reload]);
  return state;
}

export function useNavExtras(): { nav: NavItem[]; create: CreateItem[] } {
  const { data } = useRegisters();
  return useMemo(() => {
    const list = Array.isArray(data) ? data : [];
    return {
      nav: list.map((r, i): NavItem => ({
        group: navGroupOf(r.navGroup), label: r.plural, path: r.route, icon: r.icon as IconName, permission: `${r.key}.view`, order: 500 + i,
      })),
      create: list.filter((r) => r.canCreate).map((r): CreateItem => ({
        label: r.label, path: `${r.route}?new=1`, permission: `${r.key}.create`, icon: r.icon as IconName,
      })),
    };
  }, [data]);
}
