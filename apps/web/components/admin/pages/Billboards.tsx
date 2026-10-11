'use client';

import { useRef, useState } from 'react';
import { AD_ASPECTS, AD_SLOTS, type AdSlot } from '@/config/adSlots';
import { adminFetch, int, useAdmin } from '../api';
import { Columns, PALETTE } from '../charts';
import { Badge, Card, Empty, Stat, Stats, Status, query, useConfirm, useFilters } from '../ui';

interface BillboardData {
  slots: { slot: string; views: number; players: number; daily: { day: string; players: number }[] }[];
  versions: Record<string, string>;
}

const KIND: Record<string, string> = { wall: 'Painted wall', rooftop: 'Rooftop billboard', door: 'Door poster', standing: 'Standing board' };
const MAX_BYTES = 2 * 1024 * 1024;

function readSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function SlotCard({ slot, stats, version, reload }: { slot: AdSlot; stats?: BillboardData['slots'][number]; version?: string; reload: () => void }) {
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');
  const current = version ? `/billboards/${slot.id}?v=${version}` : slot.image;

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    setProblem('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setProblem('Use a PNG, JPEG or WebP image.');
    if (file.size > MAX_BYTES) return setProblem(`That's ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 2 MB.`);
    const size = await readSize(file);
    if (!size) return setProblem("That file doesn't open as an image.");
    const want = AD_ASPECTS[slot.aspect];
    const off = Math.abs(size.w / size.h / want - 1);
    const preview = URL.createObjectURL(file);
    confirm({
      title: `Replace the ${slot.id} billboard?`,
      body: (
        <>
          <img className="adm-preview" src={preview} alt="New billboard" />
          <p>
            {size.w}×{size.h} px, {(file.size / 1024).toFixed(0)} KB. Every player sees it within seconds (no redeploy).
          </p>
          {off > 0.03 && (
            <p className="adm-error">
              This slot is {slot.aspect}; the image is {(size.w / size.h).toFixed(2)}:1, so it will look stretched.
            </p>
          )}
        </>
      ),
      confirm: 'Replace image',
      run: async () => {
        await adminFetch(`/billboards/${slot.id}`, { file });
        URL.revokeObjectURL(preview);
        reload();
        return 'Billboard replaced.';
      },
    });
  };
  const reset = () =>
    confirm({
      title: `Put the original ${slot.id} art back?`,
      body: <p>The uploaded image is deleted and the built-in art returns for everyone.</p>,
      confirm: 'Reset',
      run: async () => {
        await adminFetch(`/billboards/${slot.id}/reset`, { body: {} });
        reload();
        return 'Original art restored.';
      },
    });

  return (
    <article className="adm-board">
      <div className="adm-board-art" style={{ aspectRatio: AD_ASPECTS[slot.aspect] }}>
        {/* Plain img: admin preview of an arbitrary uploaded or built-in image. */}
        <img src={current} alt={slot.advertiser} />
      </div>
      <div className="adm-board-body">
        <header>
          <code>{slot.id}</code> {slot.reserved ? <Badge>house, never sold</Badge> : version ? <Badge tone="good">replaced</Badge> : <Badge tone="muted">original</Badge>}
        </header>
        <p className="adm-small">
          {KIND[slot.kind]} · {slot.lot} · {slot.aspect}
          <br />
          {slot.advertiser}
        </p>
        <p className="adm-board-numbers">
          <b>{int(stats?.players ?? 0)}</b> players saw it <span className="muted">({int(stats?.views ?? 0)} views)</span>
        </p>
        {stats && stats.daily.length > 1 && <Columns days={stats.daily.map((d) => d.day)} series={[{ key: 'p', label: 'Players', color: PALETTE.brass, values: stats.daily.map((d) => d.players) }]} height={48} />}
        {!slot.reserved && (
          <div className="adm-row">
            <button className="adm-btn small" onClick={() => input.current?.click()}>
              Upload new image
            </button>
            {version && (
              <button className="adm-btn small ghost" onClick={reset}>
                Reset
              </button>
            )}
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </div>
        )}
        {problem && <p className="adm-error">{problem}</p>}
      </div>
    </article>
  );
}

export function BillboardsPage() {
  const { filters } = useFilters();
  const { data, error, loading, reload } = useAdmin<BillboardData>(`/billboards${query(filters)}`);
  if (!data) return <Status error={error} loading={loading} />;
  const byId = new Map(data.slots.map((s) => [s.slot, s]));
  const ordered = [...AD_SLOTS].sort((a, b) => (byId.get(b.id)?.players ?? 0) - (byId.get(a.id)?.players ?? 0));
  const total = data.slots.reduce((a, s) => a + s.views, 0);
  const top = ordered[0];
  return (
    <>
      <Stats>
        <Stat label="Billboard views" value={int(total)} sub="one per player per page visit, after 2 s on screen" />
        {top && <Stat label="Most seen" value={top.id} sub={`${int(byId.get(top.id)?.players ?? 0)} players`} />}
        <Stat label="Replaced images" value={int(Object.keys(data.versions).length)} sub={`of ${AD_SLOTS.filter((s) => !s.reserved).length} sponsor slots`} />
      </Stats>
      <Card title="Ad slots" note="How many players had each board on screen. Upload a PNG, JPEG or WebP (max 2 MB, at the slot's shape) to swap the art live." wide>
        {ordered.length === 0 ? (
          <Empty>No slots configured.</Empty>
        ) : (
          <div className="adm-boards">
            {ordered.map((s) => (
              <SlotCard key={s.id} slot={s} stats={byId.get(s.id)} version={data.versions[s.id]} reload={reload} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
