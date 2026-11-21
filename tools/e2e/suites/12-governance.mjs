// Committees and meetings (E28): a secretary records attendance on a meeting and sees the quorum
// worked out, then records a decision on it; a plan shows its element map on the policy page.
// Run alone with: npm run test:e2e -- --only governance (or --grep governance).

const meetingTest = (theme, width) => ({
  name: `governance: attendance works out the quorum, a decision is recorded (${theme}, ${width})`,
  theme, width,
  async run(t) {
    const { page } = t;
    const api = t.api();
    const tag = Date.now().toString(36);
    const committee = await t.step('set up a committee with three voting members', async () => {
      const c = await api.must('POST', '/api/committees', { name: `E2E committee ${tag}`, kind: 'safety', quorum_rule: 'count', quorum_value: 2 });
      for (const [name, side] of [['A', 'management'], ['B', 'labor'], ['C', 'labor']]) {
        await api.must('POST', `/api/committees/${c.id}/members`, { name: `E2E member ${name} ${tag}`, side });
      }
      return c;
    });
    const meeting = await api.must('POST', '/api/meetings', {
      committee_id: committee.id, title: `E2E meeting ${tag}`, scheduled_at: new Date(Date.now() - 3_600_000).toISOString(), status: 'held',
    });

    await t.step('record attendance', async () => {
      await page.goto(`/governance/meetings/${meeting.id}?tab=attendance`);
      await page.waitFor({ text: 'Save attendance' });
      t.soft((await page.text('main')).includes('No attendance recorded yet'), 'the quorum line is missing');
      await page.click({ label: `E2E member A ${tag} present` });
      await page.click({ label: `E2E member B ${tag} present` });
      await page.click({ text: 'Save attendance' });
      await page.waitFor({ text: 'Quorum met', tag: 'p' });
    });
    t.soft((await api.must('GET', `/api/meetings/${meeting.id}`)).quorum_met === true, 'the meeting does not say the quorum was met');

    await t.step('record a decision', async () => {
      await page.goto(`/governance/meetings/${meeting.id}?tab=decisions`);
      await page.click({ text: 'Record a decision' });
      await page.fill({ label: 'Decision', within: '[role="dialog"]' }, `E2E decision ${tag}`);
      await page.click({ text: 'Record', within: '[role="dialog"] .mantine-Modal-footer, [role="dialog"]' });
      await page.waitFor({ text: `E2E decision ${tag}`, tag: 'a' });
    });
    const decisions = await api.must('GET', `/api/meetings/${meeting.id}/decisions`);
    t.soft(decisions.length === 1 && /^DEC-/.test(decisions[0].ref), 'the decision was not stored');
  },
});

export const tests = [meetingTest('light', 1440), meetingTest('dark', 820)];
