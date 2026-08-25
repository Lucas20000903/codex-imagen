#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_RETRIES, KNOWN_MODELS, MAX_RETRIES, resolveConfig, UNSUPPORTED_WARNING } from '../config.js';
import { withRetries } from '../retry.js';
import { FIXED_PIXEL_AREA } from '../codex/composePrompt.js';
import { SUPPORTED_OUTPUT_FORMATS } from '../codex/buildResponsesRequest.js';
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
  '--size': 'size',
  '--format': 'outputFormat',
  '--provider': 'provider',
  '--codex-home': 'codexHome',
  '--base-url': 'baseUrl',
  '--auth-file': 'authFile',
  '--installation-id-file': 'installationIdFile',
  '--debug-dir': 'debugDir',
  '--retries': 'retries',
  '--refresh-url': 'refreshUrl'
};

const BOOLEAN_FLAGS = {
  '--transparent': 'transparent',
  '--no-retry': 'noRetry',
  '--no-refresh': 'noRefresh',
  '--dry-run': 'dryRun',
  '--debug': 'debug',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-v': 'version'
};

function parseArgs(argv) {
  const parsed = { dryRun: false, debug: false, help: false, version: false, transparent: false, images: [] };

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
  --output <path>               Output file path
  --image <path>                Reference image (repeat for multiple)
  --size <value>                Aspect ratio as WxH, W:H, or auto (e.g. 1536x1024,
                                16:9, 4:5). Sets the shape, NOT the pixel count.
  --transparent                 Ask for a transparent background
  --format <name>               ${[...SUPPORTED_OUTPUT_FORMATS].join(' | ')} (default png)
  --model <name>                Orchestrator model (default: ${KNOWN_MODELS[0]})
                                Known: ${KNOWN_MODELS.join(', ')}
  --provider <name>             ${SUPPORTED_PROVIDERS.join(' | ')}
  --retries <n>                 Retry transient failures (default ${DEFAULT_RETRIES}, max ${MAX_RETRIES})
  --no-retry                    Do not retry at all
  --no-refresh                  Do not rotate the Codex OAuth token
  --refresh-url <url>           Override the OAuth token endpoint
  --dry-run                     Print the request shape without calling the backend
  --debug                       Write sanitized request/response dumps
  --debug-dir <path>            Directory for those dumps
  --codex-home <path>           Override CODEX_HOME
  --auth-file <path>            Override auth.json path
  --installation-id-file <path> Override installation_id path
  --base-url <url>              Override the Codex base URL
  -h, --help                    Show help
  -v, --version                 Print the version and exit

Resolution is fixed: every image comes back at about ${(FIXED_PIXEL_AREA / 1e6).toFixed(2)} megapixels
(${FIXED_PIXEL_AREA.toLocaleString()} px, exactly 1536x1024) reshaped to the ratio you ask for.
2K and 4K are not reachable through this backend. The tool-level size and quality
fields are ignored by it, so --size is folded into the prompt instead; --format is
a real backend option. Every run reports the geometry actually delivered.
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

  if (args.retries !== undefined) {
    const parsed = Number(args.retries);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_RETRIES) {
      throw new Error(`--retries must be a whole number from 0 to ${MAX_RETRIES}.`);
    }
    args.retries = parsed;
  }
  if (args.noRetry) {
    args.retries = 0;
  }
  if (args.noRefresh) {
    args.refresh = false;
  }

  const config = resolveConfig(args);
  if (!SUPPORTED_PROVIDERS.includes(config.provider)) {
    throw new Error(`Unsupported provider: ${config.provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`);
  }

  const provider = createProvider(config);
  const outputPath = path.resolve(args.output || config.defaultOutputPath);
  const images = args.images.length > 0 ? await Promise.all(args.images.map(readImageAsDataUrl)) : undefined;

  console.warn(UNSUPPORTED_WARNING);

  const requestedFormat = args.outputFormat || 'png';
  const outputExtension = path.extname(outputPath).toLowerCase().replace(/^\./, '');
  if (outputExtension && EXT_TO_MIME[outputExtension] !== `image/${requestedFormat}`) {
    console.warn(`warning: --format ${requestedFormat} but --output ends in .${outputExtension}; the file will hold ${requestedFormat} bytes.`);
  }

  const result = await withRetries(
    (attempt) => {
      if (attempt > 0) {
        console.warn(`codex-imagen: attempt ${attempt + 1}/${config.retries + 1}`);
      }
      return provider.generateImage({
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
      ...(args.transparent ? { transparent: true } : {}),
        ...(args.outputFormat ? { outputFormat: args.outputFormat } : {})
      });
    },
    {
      retries: config.retries,
      onRetry: ({ attempt, retries, reason, delayMs }) =>
        console.warn(
          `codex-imagen: ${reason}; retrying ${attempt}/${retries} in ${(delayMs / 1000).toFixed(1)}s`
        )
    }
  );

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
        image: result.image,
        requestedSize: result.requestedSize,
        backendSettings: result.backendSettings,
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
