'use client';

import { useEffect, useState } from 'react';
import { useGame } from '@/lib/store';
import { ChatPanel } from './ChatPanel';
import { LogPanel } from './LogPanel';
import { NotesPanel } from './NotesPanel';
import { ScoreList } from './ScoresPanel';

type Tab = 'chat' | 'log' | 'notes' | 'scores';
const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'log', label: 'Log' },
  { id: 'notes', label: 'Notes' },
  { id: 'scores', label: 'Scores' },
];

/** Bottom sheet on phones, right column on desktop. */
export function SidePanel() {
  const [tab, setTab] = useState<Tab>('chat');
  const [open, setOpen] = useState(true);
  const chatCount = useGame((s) => s.chat.length);
  const logCount = useGame((s) => s.view?.game?.log.length ?? 0);
  const [seen, setSeen] = useState({ chat: chatCount, log: logCount });
  useEffect(() => {
    if (!open) return;
    if (tab === 'chat') setSeen((s) => (s.chat === chatCount ? s : { ...s, chat: chatCount }));
    if (tab === 'log') setSeen((s) => (s.log === logCount ? s : { ...s, log: logCount }));
  }, [tab, open, chatCount, logCount]);

  const badge = (t: Tab) => {
    if (t === 'chat' && chatCount > seen.chat) return chatCount - seen.chat;
    if (t === 'log' && logCount > seen.log) return logCount - seen.log;
    return 0;
  };

  return (
    <aside className={`side-panel${open ? '' : ' collapsed'}`}>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id && open ? 'on' : ''}
            onClick={() => {
              setTab(t.id);
              setOpen(true);
            }}
          >
            {t.label}
            {badge(t.id) > 0 && <span className="badge">{badge(t.id)}</span>}
          </button>
        ))}
        <button className="tab-toggle" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse panel' : 'Expand panel'}>
          {open ? '▾' : '▴'}
        </button>
      </nav>
      {open && (
        <div className="tab-body">
          {tab === 'chat' && <ChatPanel />}
          {tab === 'log' && <LogPanel />}
          {tab === 'notes' && <NotesPanel />}
          {tab === 'scores' && <ScoreList />}
        </div>
      )}
    </aside>
  );
}
