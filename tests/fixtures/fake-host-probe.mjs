// Stands in for scripts/local/host_probe.py: prints samples, or invalid output when asked.
const behavior = process.argv[2] ?? 'normal';
const sample = { type: 'host', intervalMs: 2000, gpu: { ours: 0.6, obs: 0.3, browser: 0.05, windowServer: 0.02, other: 0 },
  thermal: 'fair', lowPower: false, power: 'ac' };
if (behavior === 'leak') process.stdout.write(JSON.stringify({ ...sample, name: 'OBS', pid: 700 }) + '\n');
else process.stdout.write(JSON.stringify(sample) + '\n');
setInterval(() => {}, 1000);
