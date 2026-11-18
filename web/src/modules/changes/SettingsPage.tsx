import { useSearchParams } from 'react-router-dom';
import { ErrorState, Loading, PageHeader, Tabs, useFetch } from '../../core';
import { BlackoutsAdmin } from './BlackoutsAdmin';
import { QuestionnaireAdmin } from './QuestionnaireAdmin';
import { RulesAdmin } from './RulesAdmin';
import { TemplatesAdmin } from './TemplatesAdmin';
import type { ChangeSettings } from './types';

const TABS = ['templates', 'blackouts', 'rules', 'questionnaire'];

/** Templates, blackout periods, approval rules and the risk questionnaire. Needs changes.administer. */
export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useFetch<ChangeSettings>('/api/changes/settings');
  const active = TABS.includes(params.get('tab') ?? '') ? params.get('tab')! : 'templates';
  const settings = error ? <ErrorState error={error} onRetry={reload} /> : <Loading lines={6} />;

  return (
    <div className="stack">
      <PageHeader
        title="Change settings"
        subtitle="The data that drives change enablement. Every change here is recorded in the audit log."
        breadcrumbs={[{ label: 'Changes', to: '/changes' }, { label: 'Settings' }]}
      />
      <Tabs
        label="Change settings sections"
        active={active}
        onChange={(tab) => setParams({ tab }, { replace: true })}
        tabs={[
          { key: 'templates', label: 'Templates', content: <TemplatesAdmin /> },
          { key: 'blackouts', label: 'Blackout periods', content: <BlackoutsAdmin /> },
          { key: 'rules', label: 'Approval rules', content: data ? <RulesAdmin settings={data} onSaved={reload} /> : settings },
          { key: 'questionnaire', label: 'Risk questionnaire', content: data ? <QuestionnaireAdmin settings={data} onSaved={reload} /> : settings },
        ]}
      />
    </div>
  );
}
