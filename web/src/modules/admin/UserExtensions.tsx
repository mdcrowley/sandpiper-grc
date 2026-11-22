// Cards optional modules add to an administrator's user page (wave 13: the mobile app's devices), without
// editing the admin module. A module ships `web/src/modules/<module>/UserCard.tsx` exporting
//
//   export const userCards: UserCardDef[] = [{ key: 'devices', area: 'mobile', Card: DevicesCard }];
//
// Cards are found at build time and loaded on first use; a card whose area is switched off is left out.
import { useEffect, useState, type ComponentType } from 'react';
import { useAuth } from '../../core';

export interface UserCardDef {
  key: string;
  /** The feature area the card belongs to: left out while it is switched off. */
  area?: string;
  Card: ComponentType<{ userId: string }>;
}

const loaders = import.meta.glob<{ userCards?: UserCardDef[] }>('../*/UserCard.tsx');
let all: Promise<UserCardDef[]> | null = null;

function loadCards(): Promise<UserCardDef[]> {
  all ??= Promise.all(Object.entries(loaders).map(([file, load]) => load()
    .then((m) => m.userCards ?? [])
    .catch((err) => { console.error(`User card ${file} did not load:`, err); return [] as UserCardDef[]; })))
    .then((lists) => lists.flat().sort((a, b) => a.key.localeCompare(b.key)));
  return all;
}

/** The extension cards for one user, in key order. */
export function UserExtensionCards({ userId }: { userId: string }) {
  const { areaOn } = useAuth();
  const [cards, setCards] = useState<UserCardDef[]>([]);
  useEffect(() => {
    if (!Object.keys(loaders).length) return undefined;
    let live = true;
    void loadCards().then((list) => { if (live) setCards(list); });
    return () => { live = false; };
  }, []);
  return <>{cards.filter((c) => !c.area || areaOn(c.area)).map((c) => <c.Card key={c.key} userId={userId} />)}</>;
}
