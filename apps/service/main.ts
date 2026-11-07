import { access } from 'node:fs/promises';
import { z } from 'zod';
import { parsePair, type Glossary } from '../../packages/protocol/index.ts';
import { OpenAITranslator, openAITranscriberFactory } from '../../packages/providers/openai.ts';
import { AnthropicTranslator } from '../../packages/providers/anthropic.ts';
import { LOCAL_TRANSLATION_MODELS, LocalTranslator } from '../../packages/providers/local-translator.ts';
import { Controller } from './controller.ts';
import { localTranscriberFactory } from '../../packages/providers/local.ts';
import { createCaptionServer } from './server.ts';
import { EXAMPLE_GLOSSARY, PRIVATE_GLOSSARY, loadGlossary, resolveGlossaryPath } from './glossary.ts';

async function main() {
  // --offline is the listen profile with translation on this Mac: no key, no network requests.
  const offline = process.argv.includes('--offline');
  const listen = process.argv.includes('--listen') || offline;
  const config = z.object({
    OPENAI_API_KEY: z.string().default(''),
    ANTHROPIC_API_KEY: z.string().default(''),
    TRANSCRIPTION_BACKEND: z.enum(['local', 'cloud']).default('local'),
    TRANSLATION_BACKEND: z.enum(['off', 'cloud', 'local']).default('off'),
    TRANSLATION_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
    LOCAL_MODEL: z.enum(['small-q4', 'turbo-q4']).default('turbo-q4'),
    LOCAL_TRANSLATION_MODEL: z.enum(LOCAL_TRANSLATION_MODELS).default('qwen3.5-4b-q4'),
    LOCAL_MAX_TURN_MS: z.coerce.number().int().min(1000).max(12_000).default(12_000),
    LOCAL_PREVIEWS: z.enum(['on', 'off']).default(listen ? 'on' : 'off'),
    // rolling is the experimental segmentation from docs/log/2026-10-26-rolling-recognition-design.md.
    LOCAL_SEGMENTATION: z.enum(['turns', 'rolling']).default('turns'),
    // English and one other language; each needs a profile in profiles/languages.json.
    LANGUAGE_PAIR: z.string().default('en-ja').transform((value, ctx) => {
      try { return parsePair(value); } catch { ctx.addIssue({ code: 'custom', message: 'LANGUAGE_PAIR needs two distinct languages with profiles' }); return z.NEVER; }
    }),
    PORT: z.coerce.number().int().min(1024).max(65535).default(4317),
    TRANSCRIPTION_MODEL: z.string().min(1).max(80).default('gpt-live-transcribe'),
    TRANSLATION_MODEL: z.string().min(1).max(80).default('gpt-5.6-terra'),
    ANTHROPIC_TRANSLATION_MODEL: z.string().min(1).max(80).default('claude-haiku-5-5'),
    TRANSLATION_REASONING_EFFORT: z.enum(['none', 'minimal', 'low', 'medium', 'high']).default('none'),
    GLOSSARY_PATH: z.string().optional(),
  }).parse({ ...process.env, ...(listen ? { TRANSCRIPTION_BACKEND: 'local', TRANSLATION_BACKEND: offline ? 'local' : 'cloud' } : {}),
    ...(offline ? { OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' } : {}),
    ...(process.argv.includes('--local-only') ? {
    TRANSCRIPTION_BACKEND: 'local', TRANSLATION_BACKEND: 'off', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '',
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
  const localTranslation = config.TRANSLATION_BACKEND === 'local' && local;
  if (config.TRANSLATION_BACKEND === 'local' && !local) { console.error('Local translation needs local transcription.'); process.exitCode = 1; return; }
  const anthropic = config.TRANSLATION_PROVIDER === 'anthropic';
  // Cloud transcription always uses OpenAI; translation uses the selected provider.
  const configured = (local || Boolean(config.OPENAI_API_KEY.trim()))
    && (!translate || Boolean((anthropic ? config.ANTHROPIC_API_KEY : config.OPENAI_API_KEY).trim()));
  if (process.argv.includes('--preflight')) {
    let modelFiles = true;
    for (const file of ['weights.npz', 'config.json']) {
      try { await access(`.local/models/${config.LOCAL_MODEL}/${file}`); } catch { modelFiles = false; }
    }
    let python = true;
    try { await access('.local/venv/bin/python'); } catch { python = false; }
    let translatorFiles = true;
    if (localTranslation) for (const file of ['model.safetensors', 'config.json', 'tokenizer.json']) {
      try { await access(`.local/models/${config.LOCAL_TRANSLATION_MODEL}/${file}`); } catch { translatorFiles = false; }
    }
    let speechDetector = true;
    try { await access('.local/models/silero-vad/model.jit'); } catch { speechDetector = false; }
    console.log(`Preflight: credential ${configured ? 'configured' : 'missing'}; local model files ${modelFiles ? 'present' : 'missing'}; speech detector ${speechDetector ? 'present' : 'missing'};${localTranslation ? ` translation model files ${translatorFiles ? 'present' : 'missing'};` : ''} Python ${python ? 'present' : 'missing'}; glossary valid (${glossarySource}); language pair ${config.LANGUAGE_PAIR.join('-')}.`);
    console.log('No provider calls made. Model access, billing, network, microphone and translation quality are NOT verified.');
    if (!configured || !modelFiles || !python || !speechDetector || !translatorFiles) process.exitCode = 1;
    return;
  }
  const localTranslator = localTranslation ? new LocalTranslator({ model: config.LOCAL_TRANSLATION_MODEL, pair: config.LANGUAGE_PAIR }) : undefined;
  if (localTranslator) {
    console.log('Loading the local translation model…');
    try { await localTranslator.start(); } catch { console.error('Local translation model unavailable. Run pnpm local:setup-translator, then restart.'); process.exitCode = 1; return; }
  }
  const controller = new Controller({
    transcriber: local ? localTranscriberFactory({ model: config.LOCAL_MODEL, maxTurnMs: config.LOCAL_MAX_TURN_MS,
      segmentation: config.LOCAL_SEGMENTATION,
      // Previews apply to turns only; rolling replaces them with its own locked partials.
      previewIntervalMs: config.LOCAL_PREVIEWS === 'on' ? 3000 : undefined,
      calibrationMs: listen ? 1500 : undefined })
      : openAITranscriberFactory(config.OPENAI_API_KEY, config.TRANSCRIPTION_MODEL, glossary),
    translator: localTranslation ? localTranslator! : !translate ? null : anthropic
      ? new AnthropicTranslator({ key: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_TRANSLATION_MODEL, effort: config.TRANSLATION_REASONING_EFFORT, pair: config.LANGUAGE_PAIR })
      : new OpenAITranslator({ key: config.OPENAI_API_KEY, model: config.TRANSLATION_MODEL, effort: config.TRANSLATION_REASONING_EFFORT, pair: config.LANGUAGE_PAIR }),
    pair: config.LANGUAGE_PAIR,
    // The starting segmentation; the operator page can switch it while capture is off.
    ...(local ? { segmentation: config.LOCAL_SEGMENTATION } : {}),
    sessionLimitMs: local ? null : 25 * 60_000,
    glossary, backend: `${local ? 'Local' : 'Cloud'} transcription · translation ${localTranslation ? `local (${config.LOCAL_TRANSLATION_MODEL})` : translate ? `cloud (${config.TRANSLATION_PROVIDER})` : 'off'}`,
    processing: local ? (localTranslation ? 'local-audio-local-text' : translate ? 'local-audio-cloud-text' : 'local-only') : (translate ? 'cloud-audio-and-text' : 'cloud-audio-only'),
  });
  const app = await createCaptionServer({ controller, port: config.PORT, webDir: 'dist/web', configured });
  console.log(`Captions: ${app.origin}/control | OBS: ${app.origin}/overlay | glossary: ${glossarySource}`);
  if (localTranslation) console.log('Local text translation enabled: text stays on this Mac; no network requests.');
  if (translate) console.log('Cloud text translation enabled: paid requests begin after microphone Start. Audio stays local when using the local recognizer.');
  if (!configured) console.log('Provider credential missing; configure .env before starting capture.');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { localTranslator?.close(); void app.close().then(() => process.exit(0)); });
}
void main().catch(() => {
  console.error('Startup failed. Check local configuration, glossary JSON, build output, and port availability. Details suppressed to protect secrets.');
  process.exitCode = 1;
});
