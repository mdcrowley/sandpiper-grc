/** Ready-made requests an assistant can offer; each names the tools to use. */
export interface PromptSpec {
  name: string;
  title: string;
  description: string;
  /** Optional string arguments: name -> description. */
  args: Record<string, string>;
  text(args: Record<string, string | undefined>): string;
}

const CLOSING = 'Only use what the tools return; if a tool is not available to me, say which part could not be covered. '
  + 'Name every record by its reference and include its link. Do not change any record unless I ask you to.';

export const PROMPTS: PromptSpec[] = [
  {
    name: 'weekly_risk_and_action_review',
    title: 'Weekly risk and action review',
    description: 'A short weekly review of the highest risks, overdue and upcoming actions, and what needs a decision.',
    args: { focus: 'Optional area to concentrate on, e.g. "rail operations" or "OT network".' },
    text: (a) => [
      `Prepare my weekly risk and action review${a.focus ? `, concentrating on ${a.focus}` : ''}.`,
      '1. Call risk_heatmap (residual) and list the ten highest-rated open risks with owner and score.',
      '2. Call overdue_summary and list overdue actions, oldest first, grouped by owner.',
      '3. Call list_records for type "action" with filters {"status": ["open","in_progress","blocked"], "due_on.lt": <date two weeks from today>} sorted by due_on for what falls due soon.',
      '4. For any blocked action or any risk whose review is due, call get_record and summarize why.',
      'Finish with three to five decisions or follow-ups for this week.',
      CLOSING,
    ].join('\n'),
  },
  {
    name: 'board_summary',
    title: 'Prepare a board summary',
    description: 'A one-page summary for leadership or the board: risk position, framework progress, incidents, vulnerabilities, safety and service.',
    args: { period: 'The period covered, e.g. "the last quarter".' },
    text: (a) => [
      `Prepare a one-page summary for our leadership or board covering ${a.period || 'the last quarter'}, in plain language for non-specialists.`,
      'Use: risk_heatmap (risk position and the top risks), framework_progress (outcomes at target and change since the last assessment), '
        + 'incident_clocks (open security incidents and any notification deadlines), vulnerability_summary (open, overdue, known exploited), '
        + 'safety_summary (events, hazards and indicators against target), service_desk_metrics (service levels for the period) and contracts_nearing_notice (decisions due).',
      'Structure: headline (three sentences), then one short section per area with the key figures, then "Decisions and support needed".',
      'Do not include personal information about individuals involved in incidents or safety events.',
      CLOSING,
    ].join('\n'),
  },
  {
    name: 'triage_open_tickets',
    title: 'Triage open tickets',
    description: 'Look through new and unassigned tickets and suggest priority, category and who should take each.',
    args: { queue: 'Optional category or assignment group to limit the triage to.' },
    text: (a) => [
      `Help me triage the open service desk tickets${a.queue ? ` in ${a.queue}` : ''}.`,
      '1. Call list_record_types with type "ticket" to learn the statuses, priorities and categories.',
      '2. Call list_records for type "ticket" with filters {"assignee_id.null": true, "resolved_at.null": true} sorted by created_at, and also those with status "new".',
      '3. For each (up to 15), call get_record if the description is needed, and search for similar recent tickets or known errors.',
      '4. Propose for each: priority, category, a suggested assignee or group, and a one-line next step. Flag anything that looks like a security incident or a safety issue.',
      'Present a table first. Only if I then confirm, use update_record and add_comment to apply the changes, one ticket at a time.',
      CLOSING,
    ].join('\n'),
  },
  {
    name: 'incident_status_update',
    title: 'Incident status update',
    description: 'A status update for one security incident (or all open ones): timeline, containment, notifications due and next steps.',
    args: { incident: 'Incident reference, e.g. "SIR-00003" (default: every open incident).' },
    text: (a) => [
      `Write a status update for ${a.incident ? `security incident ${a.incident}` : 'each open security incident'}.`,
      '1. Call incident_clocks for the open incidents and their notification deadlines.',
      `2. ${a.incident ? `Call get_record for type "security_incident" and id "${a.incident}"` : 'For each incident call get_record'}, then get_history and get_related (affected systems, actions).`,
      '3. Write: current status and severity, what happened so far (timeline), containment, which notifications are due and when (flag any within 24 hours or overdue), open actions and owners, and next steps.',
      'Keep it factual and suitable for the incident team; leave out personal information.',
      CLOSING,
    ].join('\n'),
  },
  // E43-10: loading a whole document package with its history (developer B, wave 24).
  {
    name: 'load_document_package',
    title: 'Load a document package',
    description: 'Walks through loading a folder of controlled documents (policies, plans, procedures, SOPs, forms, external documents) with their full version history and original dates: inventory, a plan for my approval, uploads, conversion, loading oldest first, checks and a report.',
    args: {
      folder: 'The folder or package to load, as you can see it (e.g. "the IT SOPs folder").',
      department: 'Optional owning department for the documents, e.g. "Information technology".',
    },
    text: (a) => [
      `Help me load the controlled documents in ${a.folder || 'the folder I give you'} into Sandpiper GRC with their full version history${a.department ? `, owned by the ${a.department} department` : ''}.`,
      '1. Inventory: list every file with its folder, name, type and size (with list_local_files, recursive, when the files are in a folder the server may read). Skip Office lock files (names starting with ~$), thumbnail caches (Thumbs.db, .DS_Store, desktop.ini) and anything that is not a document. '
        + 'Group the files into documents and versions (older revisions, "superseded" or "archive" folders, revision letters or dates in names), and read each Word or PDF file only as far as needed to find its number, title, revision and dates.',
      '2. Call list_record_types with type "policy" and find_documents to learn the document types and what already exists, so nothing is loaded twice (save_document updates a document with the same number).',
      '3. Propose a plan as a table and wait for my approval before changing anything: per document its number (keep the organization\'s own numbers), title, type, owner, owning department, parent document, who may read it '
        + '(everyone, or restricted to departments, roles, distribution groups or people), whether readers must acknowledge it, and per version its file, version number, label, status and approved, effective and superseded dates. Mark every guess.',
      '4. Check that data load mode is on (list_record_types says so); without it the original dates and statuses are not kept and every version is a draft. If it is off, tell me to switch it on under Administration > Settings > Data load mode, and stop.',
      '5. For each document, after my approval: save_document with its details and access. Then for each version, oldest first: if list_local_files is available (local file import), give the file\'s path to convert_upload and add_document_version; '
        + 'otherwise start_upload, upload_part for each part (at most 1 MB each, base64), finish_upload with the SHA-256; '
        + 'for a Word file call convert_upload and tell me about tracked changes, comments and left-out content before going on; then add_document_version with the upload, the version number, label, status and dates. '
        + 'A legacy .doc or a scanned PDF is kept as the original file only: say so in the report. Add links (link_document) and past reviews (record_document_review) when the files show them.',
      '6. Call check_document for every document loaded and fix what it reports, or list it for me.',
      '7. Report: documents and versions loaded, files kept as originals only (and why), conversion warnings, problems left, and the link to each document. Nothing is sent to anyone during a data load; a wrong load can be undone under Administration > Data loads.',
      'Only use what the tools return. Never invent a number, date, owner or reader; ask me instead. Do not delete anything.',
    ].join('\n'),
  },
  // E45-50 (wave 25): building records completely from source files, not just their descriptions.
  {
    name: 'load_records_from_sources',
    title: 'Load records from source files',
    description: 'Walks through creating complete records of one type from source files (spreadsheets, exports, reports, emails): every field the source supports, linked records and people, child records, links, the source files attached, history as comments, and a check of what is still empty.',
    args: {
      record_type: 'The kind of record to create, e.g. "vendor", "asset", "ticket" or "contract".',
      sources: 'The source files or system, as you can see them, e.g. "the vendor list spreadsheet and the contracts folder".',
    },
    text: (a) => [
      `Help me load ${a.record_type ? `${a.record_type} records` : 'records'} into Sandpiper GRC from ${a.sources || 'the sources I give you'}, as completely as the sources allow.`,
      `1. Call list_record_types with type "${a.record_type || '<the type>'}" for its fields (labels, help, choices, custom fields) and its related types, and list_record_types for each related type you will need (for example contacts, line items, tasks). Check what already exists with search or list_records so nothing is created twice.`,
      '2. Map the sources to fields: a table of each source column or section and the field it goes to (with the related type for child data). Facts with a field of their own (people, dates, amounts, categories, statuses, linked systems, vendors, sites) go in that field, never into the description or notes. Mark anything with no field to go into, and ask me before going on if the mapping needs a decision.',
      '3. If the history must keep its original dates and authors (opened and closed times, who did what), check that data load mode is on (list_record_types says so); if it is off and I need that, tell me to switch it on under Administration > Settings > Data load mode.',
      '   People the sources name: if I ask for employees and vendor contacts to have accounts for attribution (requesters, authors, assignees, owners), create each with create_account first (data load mode only; disabled, no sign-in, nothing sent; one that exists is returned as it is). '
        + 'Put everyone else on the people roster (create_record with type "person", with their job title, phone and department), and name someone with neither as "name:<their name>". Never create an account I did not ask for.',
      '4. For each record: create_record for the parent with every mapped field. Give linked records by reference or exact title and people by username, email or name; read what the answer says each value was matched to, and fix any field it could not match rather than dropping it.',
      '5. Create its child records with create_record, setting their field that points at the parent to its reference, then link_records for the other related records the source names (relation in words, e.g. "depends on", "affects").',
      '6. Attach the source files for that record (attach_local_file when the server may read them from its own folders, see list_local_files; otherwise start_upload, upload_part, finish_upload, attach_file; mark certificates, signed agreements and audit proofs as evidence with their dates) or attach_link for documents kept elsewhere. Check list_attachments first so nothing is attached twice.',
      '7. Add its history as comments with add_comment, one per entry, oldest first (in data load mode with created_at and "as" for the person who wrote it).',
      '8. Read "unfilled" and "related_empty" in each answer, fill what the sources give with update_record, and check one record in five with get_record.',
      '9. Report: records created with their references and links, values matched (names to records and people), fields and related types left empty and why, source content that had no place, and files not attached.',
      'Only use what the sources and tools give. Never invent a value, person or date; ask me instead. Do not delete anything.',
    ].join('\n'),
  },
];
