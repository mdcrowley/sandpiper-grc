// A link to the starter structure file for an OT control catalog (E33-03), shown on Frameworks and
// structure while the OT area is on. The file holds no standard's text: placeholders only.
import { Button, api, errorMessage, useAuth, useToast } from '../../core';

export function StarterLink() {
  const { areaOn, can } = useAuth();
  const toast = useToast();
  if (!areaOn('ot') || !can('frameworks.view')) return null;
  const download = async () => {
    try {
      const file = await api.get<unknown>('/api/frameworks/starters/ot-control-structure');
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ot-control-structure.template.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  return (
    <div className="stack" style={{ gap: 'var(--s-2)' }}>
      <p className="muted" style={{ margin: 0 }}>
        For an OT control catalog, start from the OT starter structure: functions and categories with placeholders to fill from
        your own licensed copy of the standard you follow. It holds no standard's text.
      </p>
      <div><Button size="sm" icon="download" onClick={download}>Download the OT starter structure</Button></div>
    </div>
  );
}

export default StarterLink;
