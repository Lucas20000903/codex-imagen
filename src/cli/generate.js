#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWN_MODELS, resolveConfig, UNSUPPORTED_WARNING } from '../config.js';
import { SUPPORTED_IMAGE_QUALITIES, SUPPORTED_IMAGE_SIZES } from '../codex/buildResponsesRequest.js';
import { createProvider } from '../providers/createProvider.js';
import { SUPPORTED_PROVIDERS } from '../providers/providerTypes.js';

const EXT_TO_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
};

const VALUE_FLAGS = {
  '--prompt': 'prompt',
  '--output': 'output',
  '--model': 'model',
  '--image-model': 'imageModel',
  '--quality': 'quality',
  '--size': 'size',
  '--provider': 'provider',
  '--codex-home': 'codexHome',
  '--base-url': 'baseUrl',
  '--auth-file': 'authFile',
  '--installation-id-file': 'installationIdFile',
  '--debug-dir': 'debugDir'
};

const BOOLEAN_FLAGS = {
  '--dry-run': 'dryRun',
  '--debug': 'debug',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-v': 'version'
};

function parseArgs(argv) {
  const parsed = { dryRun: false, debug: false, help: false, version: false, images: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--image') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('--image needs a file path.');
      }
      parsed.images.push(value);
      index += 1;
      continue;
    }

    if (VALUE_FLAGS[token]) {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`${token} needs a value.`);
      }
      parsed[VALUE_FLAGS[token]] = value;
      index += 1;
      continue;
    }

    if (BOOLEAN_FLAGS[token]) {
      parsed[BOOLEAN_FLAGS[token]] = true;
      continue;
    }

    if (!token.startsWith('-') && !parsed.prompt) {
      parsed.prompt = token;
      continue;
    }
    if (!token.startsWith('-') && !parsed.output) {
      parsed.output = token;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return parsed;
}

async function readImageAsDataUrl(imagePath) {
  const resolved = path.resolve(imagePath);

  let stats;
  try {
    stats = await fs.stat(resolved);
  } catch {
    throw new Error(`Image file not found: ${imagePath}`);
  }
  if (!stats.isFile()) {
    throw new Error(`Image path is not a file: ${imagePath}`);
  }

  const ext = path.extname(resolved).toLowerCase().replace(/^\./, '');
  const mime = EXT_TO_MIME[ext];
  if (!mime) {
    throw new Error(`Unsupported image extension "${ext}". Supported: ${Object.keys(EXT_TO_MIME).join(', ')}.`);
  }

  return `data:${mime};base64,${(await fs.readFile(resolved)).toString('base64')}`;
}

async function readVersion() {
  const versionPath = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', 'VERSION');
  return (await fs.readFile(versionPath, 'utf8').catch(() => '0.0.0')).trim();
}

function printHelp() {
  console.log(`
${UNSUPPORTED_WARNING}

Usage:
  cxi --prompt "flat blue square icon" --output ./out/image.png

Options:
  --prompt <text>               Required prompt text
  --output <path>               Output PNG path
  --image <path>                Reference image (repeat for multiple)
  --size <value>                ${[...SUPPORTED_IMAGE_SIZES].join(', ')}
  --quality <value>             ${[...SUPPORTED_IMAGE_QUALITIES].join(', ')}
  --model <name>                Orchestrator model (default: ${KNOWN_MODELS[0]})
                                Known: ${KNOWN_MODELS.join(', ')}
  --image-model <name>          Image model override, e.g. gpt-image-2
  --provider <name>             ${SUPPORTED_PROVIDERS.join(' | ')}
  --dry-run                     Print the request shape without calling the backend
  --debug                       Write sanitized request/response dumps
  --debug-dir <path>            Directory for those dumps
  --codex-home <path>           Override CODEX_HOME
  --auth-file <path>            Override auth.json path
  --installation-id-file <path> Override installation_id path
  --base-url <url>              Override the Codex base URL
  -h, --help                    Show help
  -v, --version                 Print the version and exit

Not supported by the Codex image model: transparent backgrounds, input_fidelity.
Ask for a solid backdrop in the prompt instead.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(await readVersion());
    return;
  }
  if (args.help || !args.prompt) {
    printHelp();
    if (!args.prompt && !args.help) {
      process.exitCode = 1;
    }
    return;
  }

  const config = resolveConfig(args);
  if (!SUPPORTED_PROVIDERS.includes(config.provider)) {
    throw new Error(`Unsupported provider: ${config.provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`);
  }

  const provider = createProvider(config);
  const outputPath = path.resolve(args.output || config.defaultOutputPath);
  const images = args.images.length > 0 ? await Promise.all(args.images.map(readImageAsDataUrl)) : undefined;

  console.warn(UNSUPPORTED_WARNING);

  const result = await provider.generateImage({
    prompt: args.prompt,
    model: args.model || config.defaultModel,
    outputPath,
    dryRun: args.dryRun,
    debug: args.debug,
    debugDir: args.debugDir
      ? path.resolve(args.debugDir)
      : args.debug
        ? path.resolve('.debug-codex-imagen')
        : null,
    images,
    ...(args.size ? { size: args.size } : {}),
    ...(args.quality ? { quality: args.quality } : {}),
    ...(args.imageModel ? { imageModel: args.imageModel } : {})
  });

  if (result.mode === 'dry-run') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  for (const warning of result.warnings) {
    console.warn(`warning: ${warning}`);
  }

  console.log(
    JSON.stringify(
      {
        provider: result.provider || config.provider,
        savedPath: result.savedPath,
        model: args.model || config.defaultModel,
        responseId: result.responseId,
        sessionId: result.sessionId,
        revisedPrompt: result.revisedPrompt,
        httpStatus: result.response.status
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  // Known failures already carry an actionable message; a stack trace only
  // buries it. Unknown ones still get the full trace.
  if (error?.code && typeof error.code === 'string') {
    console.error(`${error.code}: ${error.message}`);
    if (error.retryable === false) {
      console.error('This will fail the same way on retry — change the request rather than repeating it.');
    }
  } else {
    console.error(error?.stack || error?.message || String(error));
  }
  process.exitCode = 1;
});
