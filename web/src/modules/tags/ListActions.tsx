// Extension file (inventory/Extensions.tsx): controls beside the buttons of inventory and fleet lists.
// Owner: TAGS-LOOKUP (the Find by tag number box).
import type { ListActionDef } from '../inventory/Extensions';
import { FindByTagBox } from './FindByTag';

export const listActions: ListActionDef[] = [
  { key: 'find-by-tag', area: 'tags', appliesTo: ['asset', 'site', 'system', 'vehicle'], Action: FindByTagBox },
];
