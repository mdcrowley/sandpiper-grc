// The keyboard-shortcut cheat sheet, opened with "?" or from the account menu.
import { Modal } from './overlay';

interface Shortcut {
  keys: string[][];
  what: string;
}

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: [['/'], ['Ctrl K']], what: 'Search records, pages and actions' },
      { keys: [['?']], what: 'Show this list' },
      { keys: [['G', 'O']], what: 'Go to the overview' },
      { keys: [['G', 'N']], what: 'Go to your notifications' },
      { keys: [['G', 'H']], what: 'Open Help for the page you are on' },
      { keys: [['Esc']], what: 'Close the dialog, menu or list that is open' },
      { keys: [['Tab'], ['Shift Tab']], what: 'Move to the next or previous control' },
    ],
  },
  {
    title: 'Navigation menu',
    items: [
      { keys: [['↑'], ['↓']], what: 'Move between entries' },
      { keys: [['←'], ['→']], what: 'Fold or open a group (on its heading)' },
      { keys: [['Home'], ['End']], what: 'First or last entry' },
    ],
  },
  {
    title: 'Lists',
    items: [
      { keys: [['↑'], ['↓']], what: 'Move between rows (after tabbing to the table)' },
      { keys: [['Home'], ['End']], what: 'First or last row on the page' },
      { keys: [['Enter']], what: 'Open the row' },
      { keys: [['Space']], what: 'Select or clear the row' },
    ],
  },
  {
    title: 'Records and forms',
    items: [
      { keys: [['←'], ['→']], what: 'Move between tabs (on a tab)' },
      { keys: [['Ctrl Enter']], what: 'Post the comment you are writing' },
      { keys: [['↓']], what: 'Open a picker; arrows and Enter choose' },
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Keyboard shortcuts" onClose={onClose} size="lg">
      <div className="shortcuts">
        {GROUPS.map((group) => (
          <section key={group.title} className="shortcuts-group" aria-label={group.title}>
            <h3 className="shortcuts-title">{group.title}</h3>
            <dl className="shortcuts-list">
              {group.items.map((item) => (
                <div key={item.what} className="shortcuts-row">
                  <dt>
                    {item.keys.map((combo, i) => (
                      <span key={i} className="shortcuts-combo">
                        {i > 0 && <span className="muted"> or </span>}
                        {combo.map((key, k) => (
                          <span key={k}>
                            {k > 0 && <span className="muted"> then </span>}
                            <kbd className="kbd">{key}</kbd>
                          </span>
                        ))}
                      </span>
                    ))}
                  </dt>
                  <dd>{item.what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="muted shortcuts-note">Shortcuts made of single letters work when you are not typing in a box.</p>
    </Modal>
  );
}
