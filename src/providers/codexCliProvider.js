import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SESSION_ID_PATTERN = /session id:\s*([0-9a-f-]{36})/i;
const PNG_PATTERN = /\.png$/i;
const SANDBOX_NOISE_PATTERN = /bwrap:|Failed RTM_NEWADDR/i;
const LOGGED_IN_PATTERN = /Logged in using ChatGPT/i;

function quoteForPrompt(text) {
  return text.replaceAll('"', '\\"');
}

function buildWrappedPrompt(prompt) {
  return [
    `Generate an image of "${quoteForPrompt(prompt)}".`,
    'Save the resulting image to a file, or leave a URL if saving is impossible.',
    'If neither is possible, explain exactly why.',
    'In your final answer, include the success or failure status plus the output path or URL if known.'
  ].join(' ');
}

function extractSessionId(output) {
  return output.match(SESSION_ID_PATTERN)?.[1] ?? null;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findNewestPng(directory) {
  if (!(await pathExists(directory))) {
    return null;
  }

  const entries = await fs.readdir(directory, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findNewestPng(entryPath);
      if (nested) {
        candidates.push(nested);
      }
      continue;
    }
    if (entry.isFile() && PNG_PATTERN.test(entry.name)) {
      const stat = await fs.stat(entryPath);
      candidates.push({ path: entryPath, mtimeMs: stat.mtimeMs });
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0] ?? null;
}

async function findGeneratedImage({ generatedImagesDir, sessionId, startedAtMs }) {
  if (sessionId) {
    const direct = await findNewestPng(path.join(generatedImagesDir, sessionId));
    if (direct) {
      return direct;
    }
  }

  const rootEntries = await fs.readdir(generatedImagesDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];

  for (const entry of rootEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const found = await findNewestPng(path.join(generatedImagesDir, entry.name));
    if (found && found.mtimeMs >= startedAtMs) {
      candidates.push(found);
    }
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0] ?? null;
}

function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      const error = new Error(`Command failed: ${file} ${args.join(' ')}`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = code;
      reject(error);
    });
    child.stdin.end();
  });
}

async function runCodexPreflight(execImpl) {
  const version = await execImpl('codex', ['--version']);
  const login = await execImpl('codex', ['login', 'status']);
  return {
    version: `${version.stdout || ''}${version.stderr || ''}`.trim(),
    loginStatus: `${login.stdout || ''}${login.stderr || ''}`.trim()
  };
}

async function writeDebugArtifacts({ debugDir, payload }) {
  if (!debugDir) {
    return;
  }
  await fs.mkdir(debugDir, { recursive: true });
  await fs.writeFile(path.join(debugDir, 'codex-cli-run.json'), JSON.stringify(payload, null, 2));
}

/**
 * Create a provider that drives `codex exec` and recovers the PNG it wrote.
 *
 * @param {{ generatedImagesDir: string }} config
 * @returns {{ generateImage: (args: object) => Promise<object> }}
 */
export function createCodexCliProvider(config) {
  return {
    async generateImage({ prompt, model, outputPath, debug = false, debugDir, execImpl = runCommand, images, size, transparent }) {
      if (images && images.length > 0) {
        throw new Error('The codex-cli provider does not support reference images.');
      }
      if (size) {
        throw new Error('The codex-cli provider cannot pass an aspect hint through.');
      }
      if (transparent) {
        throw new Error('The codex-cli provider cannot request a transparent background.');
      }
      if (!prompt || !prompt.trim()) {
        throw new Error('Prompt is required.');
      }

      const preflight = await runCodexPreflight(execImpl);
      if (!LOGGED_IN_PATTERN.test(preflight.loginStatus)) {
        const error = new Error(`Codex CLI is not logged in with ChatGPT: ${preflight.loginStatus}`);
        error.code = 'CODEX_CLI_NOT_LOGGED_IN';
        throw error;
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-imagen-cli-'));
      const lastMessagePath = path.join(tempDir, 'last.txt');
      const startedAtMs = Date.now();
      const args = [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox',
        'workspace-write',
        ...(model ? ['--model', model] : []),
        '-C',
        tempDir,
        '--output-last-message',
        lastMessagePath,
        buildWrappedPrompt(prompt)
      ];

      const run = await execImpl('codex', args);
      const combinedOutput = `${run.stdout || ''}\n${run.stderr || ''}`;
      const sessionId = extractSessionId(combinedOutput);
      const generated = await findGeneratedImage({
        generatedImagesDir: config.generatedImagesDir,
        sessionId,
        startedAtMs
      });

      const warnings = [];
      if (SANDBOX_NOISE_PATTERN.test(combinedOutput)) {
        warnings.push('Codex CLI printed a sandbox inspection warning; this does not by itself mean generation failed.');
      }

      if (!generated) {
        const error = new Error(
          `Codex CLI finished but wrote no PNG under ${config.generatedImagesDir}. The prompt was most likely declined.`
        );
        error.code = 'CODEX_CLI_IMAGE_NOT_FOUND';
        error.sessionId = sessionId;
        error.retryable = false;
        throw error;
      }

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.copyFile(generated.path, outputPath);

      const lastMessage = await fs.readFile(lastMessagePath, 'utf8').catch(() => '');
      if (debug) {
        await writeDebugArtifacts({
          debugDir,
          payload: {
            provider: 'codex-cli',
            preflight,
            sessionId,
            command: {
              binary: 'codex',
              args: args.map((value, index) => (index === args.length - 1 ? '[PROMPT_REDACTED]' : value))
            },
            tempDir,
            lastMessage,
            generatedImage: { sourcePath: generated.path, copiedTo: outputPath },
            warnings
          }
        });
      }

      return {
        mode: 'live',
        provider: 'codex-cli',
        warnings,
        responseId: null,
        sessionId,
        savedPath: outputPath,
        revisedPrompt: null,
        request: { provider: 'codex-cli', transport: 'codex exec', preflight },
        response: { status: 0, headers: {}, itemCount: 1, generatedSourcePath: generated.path, lastMessage }
      };
    }
  };
}

export const codexCliProviderInternals = { buildWrappedPrompt, extractSessionId, findGeneratedImage };
