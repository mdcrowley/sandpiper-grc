import type { ToolSpec } from './toolkit.ts';

// Summary tools for the program areas added in waves 10 and 11 (audits, controls, corrective action
// plans, funding, governance, qualifications, continuity, asset condition, OT, records requests and
// the vendor lifecycle). Wave 11 step 0 stub, owned by the follow-ups work. Each tool will read its
// area's summary route (contract C5) with the caller's token, and its `available` check will drop it
// while that area is switched off.

export const PROGRAM_TOOLS: ToolSpec[] = [];
