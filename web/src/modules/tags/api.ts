// The asset tags contract for the web pages: one import for the shared types and helpers
// (shared/asset-tags-api.ts, shared/tag-format.ts at the repository root). Owner: TAGS-CORE; any tags
// page may import from here.
export * from '../../../../shared/asset-tags-api.ts';
export {
  checkCharacter, cleanValue, compileSafePattern, extractFromCode, matchFormat, plainTextCandidate, sequenceValue, validCheckCharacter, valueKey,
} from '../../../../shared/tag-format.ts';
export type { CheckScheme, TagCarrier, TagCharacters, TagFormat, TagSource } from '../../../../shared/tag-format.ts';
