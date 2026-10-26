import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import { Command, FRAME_BYTES } from '../../packages/protocol/index.ts';
import type { Controller } from './controller.ts';

export async function createCaptionServer(options: { controller: Controller; port: number; webDir: string; configured: boolean }) {
  const assets = new Map<string, { body: Buffer; type: string }>();
  for (const [route, name, type] of [
    ['/control', 'control.html', 'text/html'], ['/overlay', 'overlay.html', 'text/html'],
    ['/control.js', 'control.js', 'text/javascript'], ['/overlay.js', 'overlay.js', 'text/javascript'],
    ['/worklet.js', 'worklet.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'],
  ]) assets.set(route!, { body: await readFile(`${options.webDir}/${name}`), type: `${type}; charset=utf-8` });
  let origin = '';
  const allowed = (req: IncomingMessage, websocket = false) => req.headers.host === new URL(origin).host
    && (websocket ? req.headers.origin === origin : (!req.headers.origin || req.headers.origin === origin))
    && req.headers['sec-fetch-site'] !== 'cross-site';
  const server = createServer((req, res) => {
    const route = req.url ?? '/';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('Permissions-Policy', route === '/control' ? 'microphone=(self), camera=(), display-capture=()' : 'microphone=(), camera=(), display-capture=()');
    if (!allowed(req)) { res.writeHead(403).end('Forbidden'); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (route === '/') { res.writeHead(302, { Location: '/control' }).end(); return; }
    if (route === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, configured: options.configured })); return; }
    const asset = assets.get(route);
    if (!asset) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': asset.type }).end(asset.body);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  let owner: WebSocket | undefined;
  const alive = new Map<WebSocket, boolean>();
  function send(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 128 * 1024) { ws.terminate(); return; }
    ws.send(JSON.stringify(options.controller.snapshot()));
  }
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req, true) || !['/ws/control', '/ws/overlay'].includes(req.url ?? '') || wss.clients.size >= 16 || (req.url === '/ws/control' && owner)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      const control = req.url === '/ws/control';
      if (control) owner = ws;
      alive.set(ws, true);
      let bucket = Date.now(); let frames = 0; let commands = 0;
      ws.on('pong', () => alive.set(ws, true));
      ws.on('error', () => { /* No raw errors: provider or transcript content can be sensitive. */ });
      ws.on('close', () => {
        alive.delete(ws);
        if (owner === ws) {
          owner = undefined;
          if (['active', 'connecting', 'stopping'].includes(options.controller.snapshot().capture)) options.controller.fail('capture');
        }
      });
      ws.on('message', (data, binary) => {
        if (!control) { ws.close(1008, 'Read only'); return; }
        if (Date.now() - bucket >= 1000) { bucket = Date.now(); frames = 0; commands = 0; }
        if (binary) {
          if (++frames > 40 || !Buffer.isBuffer(data) || data.length !== FRAME_BYTES) { options.controller.fail('protocol'); ws.close(1008, 'Invalid audio'); return; }
          options.controller.audio(new Uint8Array(data as Buffer)); return;
        }
        if (++commands > 10) { ws.close(1008, 'Command limit'); return; }
        try {
          const command = Command.parse(JSON.parse(data.toString()));
          switch (command.type) {
            case 'start':
              if (!options.configured) options.controller.fail('credentials');
              else void options.controller.start(command.mode);
              break;
            case 'set-mode': options.controller.setMode(command.mode); break;
            case 'flush': options.controller.flush(); break;
            case 'calibrate': options.controller.calibrate(); break;
            case 'pause': void options.controller.pause(); break;
            case 'clear': void options.controller.clear(); break;
            case 'new-session': options.controller.newSession(); break;
            case 'capture-failed': options.controller.fail('capture'); break;
          }
        } catch { options.controller.fail('protocol'); ws.close(1008, 'Invalid command'); }
      });
      send(ws);
    });
  });
  let pending: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = options.controller.subscribe(() => {
    pending ??= setTimeout(() => { pending = undefined; for (const ws of wss.clients) send(ws); }, 50);
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false); ws.ping(); send(ws);
    }
  }, 2000);
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  } catch (error) { clearInterval(heartbeat); unsubscribe(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('listen failed');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: async () => {
    clearInterval(heartbeat); clearTimeout(pending); unsubscribe(); options.controller.dispose();
    owner = undefined;
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
