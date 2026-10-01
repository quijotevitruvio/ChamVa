import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { rankCommands } from './commandSearch';
import './overlays.css';

export interface Command {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

const RECENT_KEY = 'chamva.cmdRecent';
const MAX_RECENT = 5;

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}
function saveRecent(id: string) {
  try {
    const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

interface Row {
  cmd: Command;
  group: string;
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  if (!open) return null;
  return <PaletteInner onClose={onClose} commands={commands} />;
}

function PaletteInner({ onClose, commands }: { onClose: () => void; commands: Command[] }) {
  const uid = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent] = useState(loadRecent);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const rows: Row[] = useMemo(() => {
    if (query.trim()) {
      return rankCommands(commands, query).map((cmd) => ({ cmd, group: cmd.group ?? 'Comandos' }));
    }
    const byId = new Map(commands.map((c) => [c.id, c]));
    const rec: Row[] = recent
      .map((id) => byId.get(id))
      .filter((c): c is Command => !!c)
      .map((cmd) => ({ cmd, group: 'Recientes' }));
    const recIds = new Set(rec.map((r) => r.cmd.id));
    const rest = commands
      .filter((c) => !recIds.has(c.id))
      .map((cmd) => ({ cmd, group: cmd.group ?? 'Comandos' }));
    // agrupa las demás por grupo manteniendo el orden de aparición
    const order: string[] = [];
    rest.forEach((r) => {
      if (!order.includes(r.group)) order.push(r.group);
    });
    return [...rec, ...order.flatMap((g) => rest.filter((r) => r.group === g))];
  }, [commands, query, recent]);

  const sel = Math.min(active, Math.max(rows.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [sel, rows]);

  const exec = (cmd: Command) => {
    saveRecent(cmd.id);
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rows.length) setActive((sel + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setActive((sel - 1 + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[sel]) exec(rows[sel].cmd);
    }
  };

  const listId = `${uid}-list`;
  let lastGroup = '';
  return (
    <div className="cmdk-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onKeyDown={onKeyDown}
        onKeyUp={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows[sel] ? `${uid}-opt-${sel}` : undefined}
          aria-autocomplete="list"
          placeholder="Busca una acción…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          autoComplete="off"
          spellCheck={false}
        />
        {rows.length === 0 ? (
          <div className="cmdk-empty">Sin resultados</div>
        ) : (
          <ul className="cmdk-list" id={listId} role="listbox" ref={listRef}>
            {rows.map((r, i) => {
              const header = r.group !== lastGroup;
              lastGroup = r.group;
              return (
                <li key={`${r.group}-${r.cmd.id}`} role="presentation">
                  {header && (
                    <div className="cmdk-group" role="presentation">
                      {r.group}
                    </div>
                  )}
                  <div
                    id={`${uid}-opt-${i}`}
                    role="option"
                    aria-selected={i === sel}
                    className="cmdk-item"
                    onMouseMove={() => i !== sel && setActive(i)}
                    onClick={() => exec(r.cmd)}
                  >
                    <span className="cmdk-label">{r.cmd.label}</span>
                    {r.cmd.hint && <span className="cmdk-hint">{r.cmd.hint}</span>}
                    {r.cmd.shortcut && <span className="cmdk-kbd">{r.cmd.shortcut}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
