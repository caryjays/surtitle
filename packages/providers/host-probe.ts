import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import { HostLoad } from '../protocol/index.ts';

const Line = HostLoad.extend({ type: z.literal('host') }).strict();
export type HostProbeOptions = {
  python?: string; intervalMs?: number; now?: () => number;
  workerFactory?: () => ChildProcessWithoutNullStreams;
};

// Samples what else uses the GPU, the thermal state and the power source, through scripts/local/host_probe.py, so a
// slowdown in a rehearsal's diagnostics can be told apart from the application's own load. Content-free and
// best-effort: a probe that fails or prints anything invalid stops, and latest() is null from then on; captions never
// depend on it.
export class HostProbe {
  private worker?: ChildProcessWithoutNullStreams;
  private sample: { at: number; load: HostLoad } | null = null;
  private output = '';
  private readonly now: () => number;
  constructor(private options: HostProbeOptions = {}) { this.now = options.now ?? Date.now; }
  start() {
    if (this.worker) return;
    const interval = this.options.intervalMs ?? 2000;
    const worker = this.options.workerFactory?.() ?? spawn(this.options.python ?? '.local/venv/bin/python',
      ['-I', '-u', 'scripts/local/host_probe.py', String(interval / 1000)], {
        env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    this.worker = worker;
    const stop = () => { if (this.worker === worker) this.close(); };
    worker.stderr.resume();
    worker.on('error', stop); worker.on('exit', stop); worker.stdin.on('error', stop);
    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (chunk: string) => {
      this.output += chunk;
      if (this.output.length > 16_000) { stop(); return; }
      let end: number;
      while ((end = this.output.indexOf('\n')) >= 0) {
        const line = this.output.slice(0, end); this.output = this.output.slice(end + 1);
        let parsed: z.infer<typeof Line>;
        try { parsed = Line.parse(JSON.parse(line)); } catch { stop(); return; }
        const { type: _type, ...load } = parsed;
        this.sample = { at: this.now(), load };
      }
    });
  }
  // The last sample, or null if none arrived within three intervals.
  latest(): HostLoad | null {
    const stale = 3 * (this.options.intervalMs ?? 2000);
    return this.sample && this.now() - this.sample.at <= stale ? this.sample.load : null;
  }
  close() {
    const worker = this.worker; this.worker = undefined; this.output = '';
    worker?.stdin.destroy(); worker?.kill('SIGKILL');
  }
}
