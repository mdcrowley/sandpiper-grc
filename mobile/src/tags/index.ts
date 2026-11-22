// Tag values in the app (E38-05): working out values from what the camera read (read.ts), two-frame
// agreement (reader.ts), the lookup (lookup.ts), what the screen does with the answers (decide.ts),
// the formats (formats.ts) and the screens (screens/). Owner: APP-CAMERA. The rules shared with the
// server and the web are in the repository's shared/ folder.
export {
  checkCharacter, cleanValue, extractFromCode, lookAlikeVariants, matchFormat, plainTextCandidate, validCheckCharacter, valueKey,
} from '../../../shared/tag-format.ts';
export type { TagFormat, TagSource } from '../../../shared/tag-format.ts';
export type { LookupCandidate, LookupResponse, LookupResult, TagAction, TagCard } from '../../../shared/asset-tags-api.ts';
export { actsAlone, CODE_TYPES, CODE_TYPE_LABELS, readFrame, type FrameReads, type Reading, type Trust } from './read';
export { TagReader } from './reader';
export { lookUp, lookUpTyped, type ReadingAnswer } from './lookup';
export { decide } from './decide';
