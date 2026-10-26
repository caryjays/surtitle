import { access } from 'node:fs/promises';
import { z } from 'zod';
import type { Glossary } from '../../packages/protocol/index.ts';
import { OpenAITranslator, openAITranscriberFactory } from '../../packages/providers/openai.ts';
import { Controller } from './controller.ts';
import { localTranscriberFactory } from '../../packages/providers/local.ts';
import { createCaptionServer } from './server.ts';
import { EXAMPLE_GLOSSARY, PRIVATE_GLOSSARY, loadGlossary, resolveGlossaryPath } from './glossary.ts';

async function main() {
  const listen = process.argv.includes('--listen');
  const config = z.object({
    OPENAI_API_KEY: z.string().default(''),
    TRANSCRIPTION_BACKEND: z.enum(['local', 'cloud']).default('local'),
    TRANSLATION_BACKEND: z.enum(['off', 'cloud']).default('off'),
    LOCAL_MODEL: z.enum(['small-q4', 'turbo-q4']).default('turbo-q4'),
    LOCAL_MAX_TURN_MS: z.coerce.number().int().min(1000).max(12_000).default(12_000),
    LOCAL_PREVIEWS: z.enum(['on', 'off']).default(listen ? 'on' : 'off'),
    PORT: z.coerce.number().int().min(1024).max(65535).default(4317),
    TRANSCRIPTION_MODEL: z.string().min(1).max(80).default('gpt-live-transcribe'),
    TRANSLATION_MODEL: z.string().min(1).max(80).default('gpt-5.6-terra'),
    TRANSLATION_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high']).default('none'),
    GLOSSARY_PATH: z.string().optional(),
  }).parse({ ...process.env, ...(listen ? { TRANSCRIPTION_BACKEND: 'local', TRANSLATION_BACKEND: 'cloud' } : {}),
    ...(process.argv.includes('--local-only') ? {
    TRANSCRIPTION_BACKEND: 'local', TRANSLATION_BACKEND: 'off', OPENAI_API_KEY: '',
  } : {}) });
  const resolved = await resolveGlossaryPath(config.GLOSSARY_PATH);
  let glossary: Glossary;
  try { glossary = await loadGlossary(resolved.path); }
  catch {
    console.error(`Glossary missing or invalid. Personal glossaries live in ${PRIVATE_GLOSSARY}; the tracked default is ${EXAMPLE_GLOSSARY}. Unset GLOSSARY_PATH to use them.`);
    process.exitCode = 1; return;
  }
  const glossarySource = resolved.source;
  if (resolved.retiredDefault) console.log(`GLOSSARY_PATH names the retired tracked default; using the ${glossarySource} glossary instead. Remove GLOSSARY_PATH from .env to silence this.`);
  const local = config.TRANSCRIPTION_BACKEND === 'local';
  const translate = config.TRANSLATION_BACKEND === 'cloud';
  const configured = (local && !translate) || Boolean(config.OPENAI_API_KEY.trim());
  if (process.argv.includes('--preflight')) {
    let modelFiles = true;
    for (const file of ['weights.npz', 'config.json']) {
      try { await access(`.local/models/${config.LOCAL_MODEL}/${file}`); } catch { modelFiles = false; }
    }
    let python = true;
    try { await access('.local/venv/bin/python'); } catch { python = false; }
    let speechDetector = true;
    try { await access('.local/models/silero-vad/model.jit'); } catch { speechDetector = false; }
    console.log(`Preflight: credential ${configured ? 'configured' : 'missing'}; local model files ${modelFiles ? 'present' : 'missing'}; speech detector ${speechDetector ? 'present' : 'missing'}; Python ${python ? 'present' : 'missing'}; glossary valid (${glossarySource}).`);
    console.log('No provider calls made. Model access, billing, network, microphone and translation quality are NOT verified.');
    if (!configured || !modelFiles || !python || !speechDetector) process.exitCode = 1;
    return;
  }
  const controller = new Controller({
    transcriber: local ? localTranscriberFactory({ model: config.LOCAL_MODEL, maxTurnMs: config.LOCAL_MAX_TURN_MS,
      previewIntervalMs: config.LOCAL_PREVIEWS === 'on' ? 3000 : undefined,
      calibrationMs: listen ? 1500 : undefined })
      : openAITranscriberFactory(config.OPENAI_API_KEY, config.TRANSCRIPTION_MODEL, glossary),
    translator: translate ? new OpenAITranslator({ key: config.OPENAI_API_KEY, model: config.TRANSLATION_MODEL, effort: config.TRANSLATION_REASONING_EFFORT }) : null,
    sessionLimitMs: local ? null : 25 * 60_000,
    glossary, backend: `${local ? 'Local' : 'Cloud'} transcription · translation ${translate ? 'cloud' : 'off'}`,
    processing: local ? (translate ? 'local-audio-cloud-text' : 'local-only') : (translate ? 'cloud-audio-and-text' : 'cloud-audio-only'),
  });
  const app = await createCaptionServer({ controller, port: config.PORT, webDir: 'dist/web', configured });
  console.log(`Captions: ${app.origin}/control | OBS: ${app.origin}/overlay | glossary: ${glossarySource}`);
  if (translate) console.log('Cloud text translation enabled: paid requests begin after microphone Start. Audio stays local when using the local recognizer.');
  if (!configured) console.log('Provider credential missing; configure .env before starting capture.');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
}
void main().catch(() => {
  console.error('Startup failed. Check local configuration, glossary JSON, build output, and port availability. Details suppressed to protect secrets.');
  process.exitCode = 1;
});
