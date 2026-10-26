import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/web', { recursive: true });
await build({ entryPoints: ['apps/web/control.ts', 'apps/web/overlay.ts', 'apps/web/worklet.ts'], outdir: 'dist/web', bundle: true, format: 'esm', target: 'chrome100', sourcemap: false });
await build({ entryPoints: ['apps/service/main.ts'], outfile: 'dist/service.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external' });
for (const file of ['control.html', 'overlay.html', 'style.css']) await copyFile(`apps/web/${file}`, `dist/web/${file}`);
