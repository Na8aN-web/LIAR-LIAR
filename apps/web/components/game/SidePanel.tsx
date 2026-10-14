'use client';

import { useEffect, useState } from 'react';
import { useTutorial } from '@/lib/tutorial';
import { useGame } from '@/lib/store';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { ChatPanel, useVisibleChat } from './ChatPanel';
import { LogPanel } from './LogPanel';
import { NotesPanel } from './NotesPanel';
import { ScoreList } from './ScoresPanel';

type Tab = 'chat' | 'log' | 'notes' | 'scores';
const TABS: { id: Tab; label: string }[] = [
  // Rankings first: what people look for between posters.
  { id: 'scores', label: 'Rankings' },
  { id: 'chat', label: 'Chat' },
  { id: 'log', label: 'Searches' },
  { id: 'notes', label: 'Notebook' },
];

/**
 * Bottom sheet on phones, right column on desktop. On phones it starts collapsed to
 * just the tab strip (unread counts stay visible on the tabs); tapping the open tab again,
 * or tapping the scene, folds it back down. Desktop is always open.
 */
export function SidePanel() {
  const [tab, setTab] = useState<Tab>('scores');
  // First game: Chat from the start, Searches and Notebook at stage 2, Rankings with buying.
  const { features } = useTutorial();
  const shown = TABS.filter((t) => t.id === 'chat' || (t.id === 'scores' ? features.buying : features.tabs));
  const current: Tab = shown.some((t) => t.id === tab) ? tab : 'chat';
  const desktop = useIsDesktop();
  const [openOnPhone, setOpen] = useState(false);
  const open = desktop || openOnPhone;
  const chatCount = useVisibleChat().length;
  const logCount = useGame((s) => s.view?.game?.log.length ?? 0);
  const [seen, setSeen] = useState({ chat: chatCount, log: logCount });
  const notebookEntry = useGame((s) => s.notebookEntry);
  const phase = useGame((s) => s.view?.phase);
  useEffect(() => {
    if (phase === 'vote') setOpen(false);
  }, [phase]);
  // Phones: tapping back into the scene folds the open panel away.
  useEffect(() => {
    if (desktop || !openOnPhone) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.('canvas')) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [desktop, openOnPhone]);
  useEffect(() => {
    if (!notebookEntry) return;
    setTab('notes');
    setOpen(true);
  }, [notebookEntry]);
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
        {shown.map((t) => (
          <button
            key={t.id}
            className={current === t.id && open ? 'on' : ''}
            data-tut={`tab-${t.id}`}
            onClick={() => {
              // The open tab again: fold the panel away (phones; desktop stays open).
              if (open && current === t.id) return setOpen(false);
              setTab(t.id);
              setOpen(true);
            }}
          >
            {t.label}
            {badge(t.id) > 0 && <span className="badge">{badge(t.id)}</span>}
          </button>
        ))}
      </nav>
      {open && (
        <div className="tab-body">
          {current === 'chat' && <ChatPanel />}
          {current === 'log' && <LogPanel />}
          {current === 'notes' && <NotesPanel />}
          {current === 'scores' && <ScoreList />}
        </div>
      )}
    </aside>
  );
}
