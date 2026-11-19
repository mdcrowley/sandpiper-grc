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
      '4. For any blocked action or any risk whose review is due, call get_record and summarise why.',
      'Finish with three to five decisions or follow-ups for this week.',
      CLOSING,
    ].join('\n'),
  },
  {
    name: 'board_summary',
    title: 'Prepare a board summary',
    description: 'A one-page summary for the governing body: risk position, framework progress, incidents, vulnerabilities, safety and service.',
    args: { period: 'The period covered, e.g. "the last quarter".' },
    text: (a) => [
      `Prepare a one-page summary for our governing body covering ${a.period || 'the last quarter'}, in plain language for non-specialists.`,
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
];
