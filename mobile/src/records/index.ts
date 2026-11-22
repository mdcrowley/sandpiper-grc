// Record views, search and editing of mobileEditable fields with If-Match (E38-07), My work (E38-04),
// approvals and acknowledgments (E38-08). Owner: APP-WORK.
export type { MobileHome, MobileWorkItem, MobileWorkSection } from '../../../shared/mobile-api.ts';
export { clearRecent, loadRecent, rememberRecent } from './recent';
export { recordHref, approvalHref, acknowledgmentHref } from './navigate';
export { useSecureScreen } from './secure';
export { PHONE_TYPES } from './layouts';
