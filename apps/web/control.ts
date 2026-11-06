import { connect } from './client.ts';
import { setupHistory } from './history.ts';
import { setupDiagnostics } from './diagnostics.ts';
import { setupReadingControls } from './reading.ts';
import { renderHealth, setupAudience, setupSession, setupShortcuts } from './console.ts';
import { HEARTBEAT_TIMEOUT_MS, Mode, PROFILES, direction, type Pair, type Snapshot } from '../../packages/protocol/index.ts';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const device = element<HTMLSelectElement>('device');
const mode = element<HTMLSelectElement>('mode');
const meter = element<HTMLMeterElement>('meter');
const start = element<HTMLButtonElement>('start');
const pause = element<HTMLButtonElement>('pause');
const flush = element<HTMLButtonElement>('flush');
const clear = element<HTMLButtonElement>('clear');
const newSession = element<HTMLButtonElement>('new');
const refresh = element<HTMLButtonElement>('refresh');
const calibrate = element<HTMLButtonElement>('calibrate');
const autoGain = element<HTMLInputElement>('auto-gain');
const conversation = element<HTMLButtonElement>('conversation');
const lecture = element<HTMLButtonElement>('lecture');
const follow = element<HTMLInputElement>('follow');
const captions = element('captions');
const error = element<HTMLParagraphElement>('error');
const status = element<HTMLParagraphElement>('status');
let connected = false;
let configured = true;
let busy = false;
let state: Snapshot | undefined;
let lastState = 0;
let stream: MediaStream | undefined;
let context: AudioContext | undefined;
let node: AudioWorkletNode | undefined;
let source: MediaStreamAudioSourceNode | undefined;
let captureToken = 0;
let selectedMode = Mode.parse(mode.value);
// The page ships labelled for en-ja; the first snapshot relabels it for the service's pair.
// The pair lists English first, so Lecture reads the other language into English.
let pair: Pair = ['en', 'ja'];
const name = (code: string) => PROFILES[code]?.name ?? code.toUpperCase();
const lectureMode = () => `${pair[1]}-${pair[0]}`;
function labelPair(next: Pair) {
  if (next[0] === pair[0] && next[1] === pair[1]) return;
  pair = next;
  const [a, b] = pair.map(code => code.toUpperCase()) as [string, string];
  conversation.textContent = `Conversation · ${a} ↔ ${b}`;
  lecture.textContent = `Lecture · ${name(pair[1])} → ${name(pair[0])}`;
  mode.replaceChildren(...[['auto', `Auto · ${a} ↔ ${b}`], [`${pair[0]}-${pair[1]}`, `${a} → ${b}`], [`${pair[1]}-${pair[0]}`, `${b} → ${a}`]]
    .map(([value, text]) => new Option(text, value)));
  if (![...mode.options].some(option => option.value === selectedMode)) selectedMode = 'auto';
  mode.value = selectedMode;
}
function describe(value: Mode, listening: boolean) {
  const forced = direction(value);
  if (!forced) return listening ? `Listening · automatic ${pair[0].toUpperCase()} ↔ ${pair[1].toUpperCase()}.` : `Automatic ${pair[0].toUpperCase()} ↔ ${pair[1].toUpperCase()}`;
  const route = `${name(forced.source)} → ${name(forced.target)}`;
  return listening ? `Listening · ${route}.` : `${route} · ${name(forced.source)} recognition forced`;
}
const errors = {
  credentials: 'Provider credential missing. Run pnpm preflight:listen; configure the key locally, then restart the service.',
  transcription: 'Local recognition unavailable. Check local setup and processing load, then Start again. Original text is retained.',
  translation: 'Translation failed or timed out. Original text is preserved; later turns continue. Check model access and network, or the local translation model.',
  'translation-auth': 'Translation authorization failed. Check the API project/key and model access locally, then restart. Original text is preserved.',
  'translation-rate-limit': 'Translation quota or rate limit reached. Check billing/limits. No automatic retries; Pause to stop new requests.',
  'translation-network': 'Translation network unavailable. Original captions continue locally. Later turns try normally; old failures are not replayed.',
  capture: 'Microphone capture stopped. Check the input/permissions. Select the Mac microphone as backup, then Start again.',
  overload: 'Caption backlog full; some work was skipped. Check processing load/network or Pause.',
  protocol: 'Invalid transport data. Restart this page and check service compatibility.',
  'session-limit': 'Cloud recognition session limit reached. Start a new capture session.',
};
function buttons() {
  const active = Boolean(stream) || busy || ['connecting', 'active', 'stopping'].includes(state?.capture ?? '');
  const transitioning = busy || ['connecting', 'stopping'].includes(state?.capture ?? '');
  start.disabled = !connected || !configured || active;
  pause.disabled = !connected || !active;
  flush.disabled = !connected || state?.capture !== 'active';
  clear.disabled = !connected;
  newSession.disabled = !connected;
  mode.disabled = !connected || transitioning;
  conversation.disabled = lecture.disabled = !connected || transitioning;
  device.disabled = active; refresh.disabled = active; autoGain.disabled = active;
  calibrate.disabled = !connected || state?.capture !== 'active' || !state.gate || state.gate.state === 'calibrating';
  conversation.setAttribute('aria-pressed', String(selectedMode === 'auto'));
  lecture.setAttribute('aria-pressed', String(selectedMode === lectureMode()));
}
function stopLocal() {
  captureToken++; busy = false;
  node?.disconnect(); source?.disconnect(); node = undefined; source = undefined;
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = undefined;
  void context?.close().catch(() => {}); context = undefined; meter.value = 0;
  element('capture-input').textContent = 'Input: microphone off. Reload resets selection to System default; verify the named input.';
  buttons();
}
function preserveReadingPosition(update: () => void) {
  const top = captions.getBoundingClientRect().top;
  const anchor = [...captions.children].find(child => child.getBoundingClientRect().bottom > top) as HTMLElement | undefined;
  const offset = anchor ? anchor.getBoundingClientRect().top - top : undefined;
  update();
  if (follow.checked) captions.scrollTop = captions.scrollHeight;
  else if (anchor?.isConnected && offset !== undefined) {
    captions.scrollTop += anchor.getBoundingClientRect().top - captions.getBoundingClientRect().top - offset;
  }
}
setupReadingControls(preserveReadingPosition);
const renderHistory = setupHistory(preserveReadingPosition);
const diagnostics = setupDiagnostics(() => ({ snapshot: state, online: connected }));
const renderAudience = setupAudience();
const pill = element('state-pill');
const renderSession = setupSession(command => send(command));
function renderConsole(snapshot: Snapshot | undefined) {
  const capture = !connected ? 'disconnected' : snapshot?.capture ?? 'connecting';
  if (pill.dataset.capture !== capture) { pill.dataset.capture = capture; pill.textContent = capture.toUpperCase(); }
  renderSession(snapshot, connected); renderHealth(snapshot, connected);
}
const connection = connect('control', snapshot => {
  state = snapshot; lastState = Date.now(); diagnostics.observe(snapshot); labelPair(snapshot.pair);
  element('active-direction').textContent = `Direction: ${describe(snapshot.mode, false)}`;
  // Paused selection remains local until Start; active changes are acknowledged by snapshots.
  if (['active', 'connecting', 'stopping'].includes(snapshot.capture)) {
    selectedMode = snapshot.mode; mode.value = snapshot.mode;
  }
  element('processing').textContent = {
    'local-only': 'Audio stays on this Mac. Translation is OFF; original-language captions only.',
    'local-audio-local-text': 'Audio and text stay on this Mac · local translation, no network requests.',
    'local-audio-cloud-text': 'Audio stays on this Mac · text and recent context sent to paid cloud translation.',
    'cloud-audio-and-text': 'Audio and text are processed in the cloud; provider retention policies apply.',
    'cloud-audio-only': 'Audio is processed in the cloud. Translation is OFF; provider retention policies apply.',
  }[snapshot.processing];
  status.textContent = `${snapshot.capture.toUpperCase()} · ${snapshot.backend} · queued ${snapshot.queue} · translating ${snapshot.running}${snapshot.rejected ? ` · filtered ${snapshot.rejected} suspect turns` : ''}`;
  element('gate-advice').hidden = !snapshot.gate || snapshot.gate.state === 'calibrating' || snapshot.gate.threshold < 0.03;
  element('gate-status').textContent = snapshot.gate
    ? `Noise gate: ${snapshot.gate.state} · level ${snapshot.gate.level.toFixed(4)} · threshold ${snapshot.gate.threshold.toFixed(4)}${snapshot.gate.threshold > 0.1 ? ' · High ambient level: move closer to the speaker or adjust input gain and recalibrate.' : ''}`
    : 'Noise gate diagnostics appear while listening.';
  error.textContent = snapshot.error ? errors[snapshot.error] : '';
  if (snapshot.capture === 'failed') stopLocal();
  const pending = snapshot.segments.some(row => !row.final);
  element('activity').textContent = snapshot.capture === 'active'
    ? snapshot.gate?.state === 'calibrating' ? `Stay quiet · room must also be quiet · calibrating room noise (${(snapshot.gate.remainingMs / 1000).toFixed(1)} s). Speak when Listening appears.`
      : pending ? 'Speech detected · building original text; translation follows finalization.'
      : snapshot.running ? 'Translating · microphone still listening.' : describe(snapshot.mode, true)
    : snapshot.capture === 'connecting' ? 'Warming recognition · stay quiet through the room-noise calibration before speaking.'
      : snapshot.capture === 'stopping' ? 'Finishing the last turn…' : 'Microphone is off. Recent text remains until Clear or a new Start.';
  renderHistory(snapshot); renderAudience(snapshot, lastState); renderConsole(snapshot); buttons();
}, online => {
  connected = online; diagnostics.connection(online);
  if (!online) { stopLocal(); state = undefined; status.textContent = 'Disconnected — microphone stopped. Close any other control tab, or check the service.'; }
  renderAudience(state, lastState); renderConsole(state); buttons();
});
setInterval(() => renderAudience(state, lastState), 100);
function send(command: Parameters<typeof diagnostics.command>[0]) {
  diagnostics.command(command); connection.send(command);
}
void fetch('/health').then(response => response.json()).then((health: unknown) => {
  if (typeof health === 'object' && health !== null && 'configured' in health && health.configured === false) {
    configured = false; error.textContent = errors.credentials; buttons();
  }
}).catch(() => { /* WebSocket status remains authoritative for connection health. */ });
function changeMode(value: string) {
  selectedMode = Mode.parse(value); mode.value = selectedMode;
  if (state?.capture === 'active') send({ type: 'set-mode', mode: selectedMode });
  buttons();
}
conversation.onclick = () => changeMode('auto');
lecture.onclick = () => changeMode(lectureMode());
mode.onchange = () => changeMode(mode.value);
function latest() { follow.checked = true; captions.scrollTop = captions.scrollHeight; }
element('latest').onclick = latest;
follow.onchange = () => { if (follow.checked) latest(); };
captions.addEventListener('scroll', () => {
  follow.checked = captions.scrollHeight - captions.clientHeight - captions.scrollTop < 30;
});
async function devices() {
  try {
    const selected = device.value;
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    device.replaceChildren(new Option('System default', ''), ...inputs.filter(d => d.deviceId).map((d, i) => new Option(d.label || `Microphone ${i + 1} (name after permission)`, d.deviceId)));
    device.value = [...device.options].some(o => o.value === selected) ? selected : '';
  } catch { error.textContent = 'Unable to enumerate microphones. Use Chrome on the documented loopback URL.'; }
}
refresh.onclick = () => { void devices(); };
void devices();
navigator.mediaDevices?.addEventListener('devicechange', () => { if (!stream) void devices(); });
start.onclick = async () => {
  if (!connected || busy || stream || !configured) return;
  error.textContent = ''; busy = true; buttons();
  const token = ++captureToken;
  try {
    const audioContext = new AudioContext(); context = audioContext;
    await audioContext.resume();
    const media = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: device.value ? { exact: device.value } : undefined,
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: autoGain.checked,
    }, video: false });
    if (token !== captureToken || !connected) { media.getTracks().forEach(t => t.stop()); return; }
    stream = media;
    const inputName = media.getAudioTracks()[0]?.label;
    element('capture-input').textContent = `Actual input: ${inputName || 'Unnamed browser input — verify microphone settings'}${device.value ? '' : ' · selected via System default'}`;
    await audioContext.audioWorklet.addModule('/worklet.js');
    if (token !== captureToken) return;
    source = audioContext.createMediaStreamSource(media);
    node = new AudioWorkletNode(audioContext, 'pcm-capture');
    node.port.onmessage = event => {
      if (token !== captureToken) return;
      const { pcm, rms } = event.data as { pcm: ArrayBuffer; rms: number };
      meter.value = Math.min(1, rms * 6);
      if (state?.capture === 'active' && !connection.audio(pcm)) {
        error.textContent = 'Audio transport stalled. Capture stopped instead of buffering stale speech.';
        send({ type: 'capture-failed' }); stopLocal();
      }
    };
    node.onprocessorerror = () => { send({ type: 'capture-failed' }); stopLocal(); };
    media.getTracks().forEach(track => { track.onended = () => { send({ type: 'capture-failed' }); stopLocal(); }; });
    source.connect(node); node.connect(audioContext.destination);
    send({ type: 'start', mode: selectedMode });
    busy = false; buttons(); void devices();
  } catch {
    if (token === captureToken) {
      stopLocal(); error.textContent = 'Could not start audio. Check microphone permission/input; select the Mac microphone as backup.';
      send({ type: 'capture-failed' });
    }
  }
};
pause.onclick = () => { stopLocal(); send({ type: 'pause' }); };
flush.onclick = () => send({ type: 'flush' });
calibrate.onclick = () => send({ type: 'calibrate' });
clear.onclick = () => { error.textContent = ''; send({ type: 'clear' }); };
newSession.onclick = () => { stopLocal(); send({ type: 'new-session' }); };
window.addEventListener('beforeunload', event => { if (stream || busy) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { stopLocal(); send({ type: 'capture-failed' }); });
setInterval(() => {
  if (stream && Date.now() - lastState > HEARTBEAT_TIMEOUT_MS) {
    stopLocal(); send({ type: 'capture-failed' }); error.textContent = 'Service heartbeat lost. Microphone stopped.';
  }
}, 1000);
setupShortcuts({
  s: () => { if (!start.disabled) start.click(); else if (!pause.disabled) pause.click(); },
  t: () => { if (!flush.disabled) flush.click(); },
  1: () => { if (!mode.disabled) changeMode('auto'); },
  2: () => { if (!mode.disabled) changeMode(lectureMode()); },
  3: () => { if (!mode.disabled) changeMode(`${pair[0]}-${pair[1]}`); },
  r: () => element('reading-focus').click(),
  l: latest,
  '/': () => element('history-search').focus(),
});
