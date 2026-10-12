import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

// Trailer studio backend (dev builds only): reads and saves trailers/*.json, serves music files
// from the repo, and runs the renderer (tools/render-trailer.mjs) for the Record button.
// Production answers 404 for all of it.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Dev-only paths: kept out of production file tracing.
const ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), '../..');
const TRAILERS = path.join(ROOT, 'trailers');
const dev = process.env.NODE_ENV === 'development';

const notFound = () => new Response('Not found', { status: 404 });
const json = (v: unknown, status = 200) => Response.json(v, { status });

function scriptPath(name: string | null): string | null {
  if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) return null;
  return path.join(TRAILERS, `${name}.json`);
}

/** A file inside the repo (no escaping it with ../). */
function repoFile(rel: string | null): string | null {
  if (!rel) return null;
  const p = path.resolve(ROOT, rel);
  return p.startsWith(ROOT + path.sep) ? p : null;
}

const AUDIO: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' };

interface Job {
  id: string;
  state: 'running' | 'done' | 'error';
  frame: number;
  frames: number;
  message: string;
  outputs: string[];
}
const jobs: Map<string, Job> = ((globalThis as { __trailerJobs?: Map<string, Job> }).__trailerJobs ??= new Map());

export async function GET(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  if (!dev) return notFound();
  const [what] = (await ctx.params).slug;
  const q = new URL(req.url).searchParams;

  if (what === 'scripts') {
    await mkdir(TRAILERS, { recursive: true });
    const names = (await readdir(TRAILERS)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    return json(names.sort());
  }
  if (what === 'script') {
    const p = scriptPath(q.get('name'));
    if (!p || !existsSync(p)) return notFound();
    const [text, st] = await Promise.all([readFile(p, 'utf8'), stat(p)]);
    return new Response(text, { headers: { 'content-type': 'application/json', 'x-mtime': String(st.mtimeMs), 'cache-control': 'no-store' } });
  }
  if (what === 'file') {
    const p = repoFile(q.get('path'));
    const type = p ? AUDIO[path.extname(p).toLowerCase()] : undefined;
    if (!p || !type || !existsSync(p)) return notFound();
    const st = await stat(p);
    return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, { headers: { 'content-type': type, 'content-length': String(st.size) } });
  }
  if (what === 'render') {
    const job = jobs.get(q.get('id') ?? '');
    return job ? json(job) : notFound();
  }
  return notFound();
}

export async function PUT(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  if (!dev) return notFound();
  const [what] = (await ctx.params).slug;
  if (what !== 'script') return notFound();
  const p = scriptPath(new URL(req.url).searchParams.get('name'));
  if (!p) return json({ error: 'Bad name' }, 400);
  const text = await req.text();
  try {
    JSON.parse(text);
  } catch {
    return json({ error: 'Not JSON' }, 400);
  }
  await mkdir(TRAILERS, { recursive: true });
  await writeFile(p, text);
  const st = await stat(p);
  return new Response(null, { status: 204, headers: { 'x-mtime': String(st.mtimeMs) } });
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string[] }> }) {
  if (!dev) return notFound();
  const [what] = (await ctx.params).slug;
  if (what !== 'render') return notFound();
  if ([...jobs.values()].some((j) => j.state === 'running')) return json({ error: 'A render is already running.' }, 409);
  const body = (await req.json().catch(() => ({}))) as { script?: string; format?: string; res?: string; layers?: boolean; png?: boolean; alpha?: boolean };
  if (!scriptPath(body.script ?? null)) return json({ error: 'Bad script name' }, 400);
  const origin = new URL(req.url).origin;
  const args = [path.join(ROOT, 'tools/render-trailer.mjs'), body.script!, '--format', body.format === '9:16' ? '9:16' : '16:9', '--res', body.res === '4K' ? '4k' : '1080p', '--url', origin, '--progress'];
  if (body.layers) args.push('--layers');
  if (body.png) args.push('--png');
  if (body.alpha) args.push('--alpha');
  const id = Math.random().toString(36).slice(2, 10);
  const job: Job = { id, state: 'running', frame: 0, frames: 0, message: 'Starting the renderer…', outputs: [] };
  jobs.set(id, job);
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const onLine = (line: string) => {
    const m = /^PROGRESS (.*)$/.exec(line);
    if (m) {
      try {
        Object.assign(job, JSON.parse(m[1]));
      } catch {
        /* ignore */
      }
    } else if (line.trim()) job.message = line.trim().slice(0, 300);
  };
  child.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    lines.forEach(onLine);
  });
  child.stderr.on('data', (d: Buffer) => (job.message = d.toString().trim().split('\n').pop()!.slice(0, 300)));
  child.on('exit', (code) => {
    if (job.state === 'running') {
      job.state = code === 0 ? 'done' : 'error';
      if (code !== 0) job.message = `Renderer stopped (exit ${code}): ${job.message}`;
    }
  });
  return json({ id });
}
