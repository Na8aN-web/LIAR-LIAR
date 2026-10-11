import { monitorEventLoopDelay } from 'node:perf_hooks';
import { cpus, loadavg, totalmem } from 'node:os';

/** Server health for the Live page: memory, CPU, event-loop delay, and recent errors. */
export class Monitor {
  readonly errors: { at: string; message: string }[] = [];
  private lastCpu = process.cpuUsage();
  private lastAt = performance.now();
  private cpuPercent = 0;
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  readonly startedAt = Date.now();

  constructor() {
    this.loop.enable();
  }

  /** Remembers the last 100 errors (messages only; handlers never log payloads or tokens). */
  recordError(message: string) {
    this.errors.unshift({ at: new Date().toISOString(), message: message.slice(0, 500) });
    if (this.errors.length > 100) this.errors.length = 100;
  }

  /** Call every few seconds: CPU use since the last call. */
  sample() {
    const now = performance.now();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsedUs = (now - this.lastAt) * 1000;
    this.cpuPercent = elapsedUs > 0 ? ((cpu.user + cpu.system) / elapsedUs) * 100 : 0;
    this.lastCpu = process.cpuUsage();
    this.lastAt = now;
  }

  system() {
    const m = process.memoryUsage();
    const out = {
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      memory: { rssMb: m.rss / 2 ** 20, heapUsedMb: m.heapUsed / 2 ** 20, heapTotalMb: m.heapTotal / 2 ** 20, machineMb: totalmem() / 2 ** 20 },
      cpuPercent: this.cpuPercent,
      cores: cpus().length,
      loadAverage: loadavg()[0],
      eventLoopDelayMs: { p50: this.loop.percentile(50) / 1e6, p99: this.loop.percentile(99) / 1e6, max: this.loop.max / 1e6 },
      node: process.version,
    };
    this.loop.reset();
    return out;
  }

  /** Copies console.error output (and crashes about to happen) into the recent-errors list. */
  captureConsole() {
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      this.recordError(args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      original(...args);
    };
    process.on('uncaughtExceptionMonitor', (err) => this.recordError(`Uncaught: ${err.message}`));
  }
}
