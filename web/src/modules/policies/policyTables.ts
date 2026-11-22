/** Puts each table of policy HTML in its own scroll box (`.pol-table-wrap`, see `PolicyBody`). */
export function wrapPolicyTables(html: string): string {
  return html.replace(/<table\b/g, '<div class="pol-table-wrap"><table').replace(/<\/table>/g, '</table></div>');
}
