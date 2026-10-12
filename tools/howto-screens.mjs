// Captures the How to Play screenshots from a scripted bot game.
//   pnpm howto:screens               (uses the dev server on :3000/:3001, starts it if needed)
//   HOWTO_BASE=http://host:3000 pnpm howto:screens
//   HOWTO_BROWSER=C:/path/to/chrome.exe pnpm howto:screens   (default: installed Edge, then Chrome)
//
// Plays one game as "Ada" with seven bots on a phone-sized screen, stops at the moment each
// slide describes, rings the relevant part (circle and arrow), and writes
// apps/web/public/howto/slide-1..10.webp (plus PNG copies in screenshots/howto/ for review).
// Slide text and numbers live in apps/web/components/howto/slides.ts, read from the rules.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.HOWTO_BASE ?? 'http://localhost:3000';
const OUT = join(ROOT, 'apps/web/public/howto');
const REVIEW = join(ROOT, 'screenshots/howto');
const VIEW = { width: 390, height: 844 };
const BOTS = 7;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- server
async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}
let dev = null;
if (!(await up(BASE))) {
  if (process.env.HOWTO_BASE) throw new Error(`Nothing answering at ${BASE}`);
  console.log('Starting the dev servers (pnpm dev)…');
  dev = spawn('pnpm', ['dev'], { cwd: ROOT, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 120 && !(await up(BASE)); i++) await wait(1000);
  if (!(await up(BASE))) throw new Error('The dev server did not start');
}

// ---------------------------------------------------------------- browser
async function launch() {
  const opts = { args: ['--enable-gpu', '--ignore-gpu-blocklist'] };
  if (process.env.HOWTO_BROWSER) return chromium.launch({ ...opts, executablePath: process.env.HOWTO_BROWSER });
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ ...opts, channel });
    } catch {
      /* try the next */
    }
  }
  throw new Error('No Edge or Chrome found; set HOWTO_BROWSER to a Chromium-based browser');
}
const browser = await launch();
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// No first-game walkthrough, no sound, in the captured game.
await ctx.addInitScript(() => {
  localStorage.setItem('wtc:howto-seen', '1');
  localStorage.setItem('wtc:audio', JSON.stringify({ muted: true }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.warn('page error:', e.message));

// Hide dev-only controls and the perf readout in the shots.
const CLEAN_CSS = '.dev-skip, nextjs-portal { visibility: hidden !important; }';
const skip = () => page.evaluate(() => document.querySelector('.dev-skip')?.click());
const phase = () => page.evaluate(() => document.querySelector('.phase-name')?.textContent ?? '');
async function waitPhase(re, ms = 15000) {
  for (let t = 0; t < ms; t += 250) {
    if (re.test(await phase())) return;
    await wait(250);
  }
  throw new Error(`phase ${re} not reached (now: ${await phase()})`);
}
async function quiet() {
  // Let telegrams slide away so they don't cover the shot.
  await page.evaluate(() => document.querySelectorAll('.notes-stack .note, .notes-stack > *').forEach((n) => n.remove()));
  await wait(300);
}

// ---------------------------------------------------------------- highlights
/** Rings each target (box in CSS px) and points an arrow at the first one. */
async function highlight(targets, arrowFrom = 'below') {
  await page.evaluate(
    ({ targets, arrowFrom }) => {
      document.getElementById('howto-hl')?.remove();
      const W = innerWidth;
      const H = innerHeight;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.id = 'howto-hl';
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      Object.assign(svg.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '9999', pointerEvents: 'none' });
      const el = (name, attrs) => {
        const e = document.createElementNS(ns, name);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
        svg.appendChild(e);
        return e;
      };
      const defs = el('defs', {});
      const marker = document.createElementNS(ns, 'marker');
      Object.entries({ id: 'hl-head', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto-start-reverse' }).forEach(([k, v]) =>
        marker.setAttribute(k, String(v)),
      );
      const tip = document.createElementNS(ns, 'path');
      tip.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      tip.setAttribute('fill', '#ffcf4d');
      marker.appendChild(tip);
      defs.appendChild(marker);
      for (const t of targets) {
        const cx = t.x + t.w / 2;
        const cy = t.y + t.h / 2;
        const rx = t.w / 2 + 10;
        const ry = t.h / 2 + 10;
        el('ellipse', { cx, cy, rx, ry, fill: 'none', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': 9 });
        el('ellipse', { cx, cy, rx, ry, fill: 'none', stroke: '#ffcf4d', 'stroke-width': 4.5, 'stroke-dasharray': '1 0' });
      }
      const t = targets[0];
      if (t && arrowFrom !== 'none') {
        const cx = t.x + t.w / 2;
        const cy = t.y + t.h / 2;
        const ry = t.h / 2 + 16;
        const rx = t.w / 2 + 16;
        const [sx, sy, ex, ey] =
          arrowFrom === 'below'
            ? [Math.min(W - 40, cx + 70), Math.min(H - 20, cy + ry + 90), cx + 10, cy + ry]
            : arrowFrom === 'above'
              ? [Math.max(40, cx - 70), Math.max(20, cy - ry - 90), cx - 10, cy - ry]
              : arrowFrom === 'left'
                ? [Math.max(20, cx - rx - 90), cy + 60, cx - rx, cy + 6]
                : [Math.min(W - 20, cx + rx + 90), cy + 60, cx + rx, cy + 6];
        const d = `M${sx},${sy} Q${(sx + ex) / 2 + 30},${(sy + ey) / 2} ${ex},${ey}`;
        el('path', { d, fill: 'none', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': 9, 'stroke-linecap': 'round' });
        el('path', { d, fill: 'none', stroke: '#ffcf4d', 'stroke-width': 4.5, 'stroke-linecap': 'round', 'marker-end': 'url(#hl-head)' });
      }
      document.body.appendChild(svg);
    },
    { targets, arrowFrom },
  );
}
const box = async (selector) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`nothing to highlight: ${selector}`);
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

const shots = [];
/** Screenshot with the current highlight, then clear the highlight. */
async function capture() {
  await page.addStyleTag({ content: CLEAN_CSS });
  await wait(250);
  const png = await page.screenshot();
  await page.evaluate(() => document.getElementById('howto-hl')?.remove());
  return png;
}
async function shoot(n, note) {
  await save(n, await capture(), note);
}
async function save(n, png, note) {
  await mkdir(OUT, { recursive: true });
  await mkdir(REVIEW, { recursive: true });
  await sharp(png).resize(VIEW.width * 2).webp({ quality: 78 }).toFile(join(OUT, `slide-${n}.webp`));
  await writeFile(join(REVIEW, `slide-${n}.png`), png);
  shots.push(`slide-${n}: ${note}`);
  console.log(`slide ${n}  ${note}`);
}

/** Skips ahead to the next poster's search phase. */
async function nextRound() {
  for (let k = 0; k < 5 && !/poster/i.test(await phase()); k++) {
    await skip();
    await wait(700);
  }
  await skip();
  await waitPhase(/search/i);
}
/** The slides are from a hunter's side: if Ada drew the outlaw, move on to the next poster. */
async function hunterRound() {
  for (let tries = 0; tries < 6 && (await page.locator('.outlaw-banner').count()); tries++) await nextRound();
}

// ---------------------------------------------------------------- the game
try {
  await page.goto(BASE);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByPlaceholder('Dusty').fill('Ada');
  await page.getByRole('button', { name: /Create a Room/ }).click();
  await page.getByRole('button', { name: /^Open a (private|public) room/ }).click();
  await page.waitForURL(/\/r\//);
  await page.getByRole('button', { name: '+ Bot' }).waitFor();
  for (let i = 0; i < BOTS; i++) {
    await page.getByRole('button', { name: '+ Bot' }).click();
    await wait(150);
  }

  // 2. Your secret color: the lobby's garment and color picker.
  await page.locator('summary', { hasText: 'Your garment & color' }).click();
  await wait(600);
  await highlight([await box('.look-row:has-text("Your color")')], 'below');
  await shoot(2, 'the color picker in the lobby');
  await page.locator('summary', { hasText: 'Your garment & color' }).click();

  // 3. The Wanted poster appearing, at the start of the first poster.
  await page.getByRole('button', { name: 'Start the hunt' }).click();
  await waitPhase(/poster/i);
  await wait(1200);
  await highlight([await box('.center-card .poster-svg')], 'none');
  await shoot(3, 'a new Wanted poster');
  await skip();
  await waitPhase(/search/i);
  await hunterRound();
  // Give the bots a few seconds to search, so the log and eye badges have entries.
  await wait(6000);
  await quiet();

  // 1. What is this game: the circle at the fire.
  const circle = await page.evaluate(() => window.__wtcCircle?.());
  await highlight([circle], 'none');
  await shoot(1, 'the circle around the fire');

  // 4 + 5. Search one scarecrow: the first result, then searches until a single color has shown
  // up every time. With three fakes two colors can survive three searches; then try again next
  // poster with someone else (slide 4 is kept from the attempt that works out).
  // Players are picked by tapping their scarecrow (there's no list of names any more).
  const pickPlayer = async (i) => {
    const at = await page.evaluate((n) => {
      const ids = window.__wtcOthers?.() ?? [];
      return ids.length ? window.__wtcScreen?.(ids[n % ids.length]) : null;
    }, i);
    if (at) await page.mouse.click(at.x, at.y);
  };
  const othersCount = () => page.evaluate(() => window.__wtcOthers?.().length ?? 0);
  const clearPick = () => page.locator('.target-card .icon-btn[aria-label="Clear selection"]').click().catch(() => {});
  const common = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('.target-section')][0]?.querySelectorAll('.result-row') ?? [];
      const sets = [...rows].map((r) => new Set([...r.querySelectorAll('.chip-row > *')].map((c) => c.textContent?.trim())));
      if (!sets.length) return 99;
      return [...sets[0]].filter((c) => sets.every((s) => s.has(c))).length;
    });
  let first = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await pickPlayer(attempt % 3);
    for (let k = 0; k < 3; k++) {
      const search = page.getByRole('button', { name: /^Search/ }).first();
      if (!(await search.isEnabled().catch(() => false))) break;
      await search.click();
      await wait(900);
      if (await page.locator('.target-summary').count()) await page.locator('.target-summary').click();
      if (k === 0) {
        await quiet();
        await highlight([await box('.target-section .result-row')], 'left');
        first = await capture();
      }
      if (k >= 1 && (await common()) === 1) break;
    }
    if ((await common()) === 1) break;
    await clearPick();
    await nextRound();
    await hunterRound();
  }
  await save(4, first, 'a first search result');
  // Let the card show every result row for this one shot, and ring the repeated color.
  await page.addStyleTag({ content: '.target-body { max-height: none !important; overflow: visible !important; }' });
  await quiet();
  await page.evaluate(() => document.querySelector('.target-section .result-row')?.scrollIntoView({ block: 'start' }));
  await wait(300);
  const repeated = await page.evaluate(() => {
    const rows = [...(document.querySelector('.target-section')?.querySelectorAll('.result-row') ?? [])];
    const chips = rows.map((r) => [...r.querySelectorAll('.chip-row > *')]);
    const names = chips.map((cs) => new Set(cs.map((c) => c.textContent?.trim())));
    const shared = [...(names[0] ?? [])].filter((n) => names.every((s) => s.has(n)));
    return chips
      .flat()
      .filter((c) => shared.includes(c.textContent?.trim()))
      .map((c) => c.getBoundingClientRect())
      .filter((b) => b.top >= 0 && b.bottom <= innerHeight - 60)
      .map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height }));
  });
  await highlight(repeated.length ? repeated : [await box('.target-section')], 'left');
  await shoot(5, 'three searches with the repeated color circled');
  await page.evaluate(() => [...document.querySelectorAll('style')].filter((s) => s.textContent?.includes('.target-body { max-height: none')).forEach((s) => s.remove()));
  await clearPick();

  // 6. Eye badges: the name plates of everyone searched this poster (wait for the bots to spread out).
  for (let t = 0; t < 30 && (await page.evaluate(() => window.__wtcEyes?.().length ?? 0)) < 4; t++) await wait(1000);
  await quiet();
  const eyes = (await page.evaluate(() => window.__wtcEyes?.() ?? [])).filter((e) => e.y > 90 && e.y < 560).slice(0, 5);
  await highlight(
    eyes.map((e) => ({ x: e.x - 46, y: e.y - 15, w: 92, h: 30 })),
    'none',
  );
  await shoot(6, `${eyes.length} eye badges`);

  // 7. Talk, or lie: a few claims in the chat.
  const chatTab = page.getByRole('button', { name: /^chat/i }).first();
  await chatTab.click();
  const said = page.getByPlaceholder(/speak up/i);
  await said.fill('Searched Hank three times. Lavender every time.');
  await said.press('Enter');
  // Bots chat on their own as the round goes on; wait for a few claims from them.
  for (let t = 0; t < 45 && (await page.locator('.chat-list li').count()) < 4; t++) await wait(1000);
  await quiet();
  await highlight([await box('.tab-body')], 'none');
  await shoot(7, 'the chat with a few claims');
  // Tapping the open tab again folds the panel (phones).
  if (await page.locator('.side-panel:not(.collapsed)').count()) await chatTab.click();

  // 8. Buying clues: someone else's search with a Buy button, and the extra search.
  let found = false;
  for (let i = 0, n = await othersCount(); i < n && !found; i++) {
    // Picking a scarecrow swaps the chip row for its card, so clear it before the next try.
    await clearPick();
    await wait(200);
    await pickPlayer(i);
    await wait(300);
    if (await page.locator('.target-summary').count()) await page.locator('.target-summary').click();
    await wait(200);
    found = (await page.locator('.inspector-row .btn').count()) > 0;
  }
  await quiet();
  if (found) await page.locator('.inspector-row .btn').first().scrollIntoViewIfNeeded();
  await wait(300);
  const buy = found ? [await box('.inspector-row .btn')] : [];
  if (await page.getByRole('button', { name: /^buy \d+ more/i }).count()) buy.push(await box('.btn.buy-more'));
  await highlight(buy, 'above');
  await shoot(8, found ? 'the buy button and the extra search' : 'the extra search (no bot search to buy yet)');

  // 9. Accuse the outlaw: the accuse panel.
  await clearPick();
  await skip();
  await waitPhase(/name the outlaw|accuse|vote/i);
  await page.locator('.action-bar.vote .player-chip').nth(1).click();
  await wait(400);
  await quiet();
  await highlight([await box('.action-bar.vote')], 'above');
  await shoot(9, 'the accuse panel');

  // 10. Changing colors, and winning: the color change option and the ledger.
  await page.getByRole('button', { name: /^Accuse/ }).click().catch(() => {});
  await skip();
  await waitPhase(/bounty paid|payout/i);
  await wait(1200);
  await quiet();
  await highlight([await box('button:has-text("Change colors")'), await box('.payout .scores')], 'none');
  await shoot(10, 'the color change option and the ledger');
} finally {
  await browser.close();
  if (dev) {
    // pnpm dev runs two servers; take the whole tree down.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(dev.pid), '/t', '/f'], { stdio: 'ignore' });
    else dev.kill('SIGTERM');
  }
}
console.log(`\nWrote ${shots.length} slides to ${OUT}`);
