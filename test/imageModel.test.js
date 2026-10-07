import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { resolveConfig } from '../src/config.js';
import { createProvider } from '../src/providers/createProvider.js';

const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/generate.js', import.meta.url));
const flare = 'gpt-image-2.5-flare';
const sunburst = 'gpt-image-2.5-sunburst';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-imagen-model-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const authFile = path.join(dir, 'auth.json');
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  await fs.writeFile(authFile, JSON.stringify({
    auth_mode: 'chatgpt', tokens: { access_token: `test.${payload}.test`, account_id: 'test-account' }
  }));
  return {
    dir,
    config: {
      provider: 'codex-http', baseUrl: 'https://example.test/backend-api/codex', authFile,
      installationIdFile: path.join(dir, 'installation_id'), defaultOriginator: 'codex_cli_rs', refresh: false
    }
  };
}

test('CLI preserves backend choice, reads the environment, and lets the flag override it', async (t) => {
  const { dir, config } = await fixture(t);
  for (const { envModel, flagModel, expected } of [
    { expected: undefined },
    { envModel: flare, expected: flare },
    { envModel: flare, flagModel: sunburst, expected: sunburst }
  ]) {
    const env = { ...process.env, CODEX_IMAGEN_IMAGE_MODEL: envModel ?? '' };
    const { stdout } = await execFileAsync(process.execPath, [
      cli, '--prompt', 'a blue square', '--dry-run', '--no-refresh', '--provider', 'codex-http',
      '--base-url', config.baseUrl, '--auth-file', config.authFile, '--installation-id-file', config.installationIdFile,
      '--model', 'gpt-5.6-sol', '--output', path.join(dir, 'out.png'),
      ...(flagModel ? ['--image-model', flagModel] : [])
    ], { env });
    const body = JSON.parse(stdout).request.body;
    assert.equal(body.model, 'gpt-5.6-sol');
    assert.equal(body.tools[0].model, expected);
    assert.equal(Object.hasOwn(body.tools[0], 'model'), expected !== undefined);
  }
});

test('CLI rejects an absent or blank image model value', async () => {
  for (const tail of [[], [''], ['--dry-run']]) {
    await assert.rejects(
      execFileAsync(process.execPath, [cli, '--prompt', 'x', '--image-model', ...tail]),
      (error) => /--image-model needs/.test(error.stderr)
    );
  }
});

test('SDK uses defaultImageModel and allows a per-call override', async (t) => {
  const { config } = await fixture(t);
  const resolved = { ...resolveConfig({ defaultImageModel: flare }), ...config };
  const provider = createProvider(resolved);
  for (const imageModel of [undefined, sunburst]) {
    const result = await provider.generateImage({ prompt: 'x', model: 'gpt-5.6-sol', imageModel, dryRun: true });
    assert.equal(result.request.body.tools[0].model, imageModel ?? flare);
  }
});

test('HTTP retry after 401 preserves the image model and reports requested and returned models separately', async (t) => {
  const { dir, config } = await fixture(t);
  const requests = [];
  const result = await createProvider({ ...config, refresh: true, defaultImageModel: flare }).generateImage({
    prompt: 'x', model: 'gpt-5.6-sol', outputPath: path.join(dir, 'out.png'),
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return requests.length === 1
        ? new Response('{}', { status: 401 })
        : new Response(JSON.stringify({ output: [{ type: 'image_generation_call', result: png }] }), {
          status: 200, headers: { 'content-type': 'application/json' }
        });
    }
  });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.tools[0].model, flare);
    assert.equal(request.model, 'gpt-5.6-sol');
  }
  assert.equal(result.requestedImageModel, flare);
  assert.equal(result.backendSettings.model, null);
  assert.equal(result.image.format, 'png');
});

test('auto does not drop explicit or configured image models when HTTP fails', async (t) => {
  const { config } = await fixture(t);
  for (const useDefault of [false, true]) {
    let executed = false;
    await assert.rejects(
      createProvider({ ...config, provider: 'auto', ...(useDefault ? { defaultImageModel: flare } : {}) }).generateImage({
        prompt: 'x', model: 'gpt-5.6-sol', ...(useDefault ? {} : { imageModel: flare }),
        fetchImpl: async () => { throw new Error('network unavailable'); },
        execImpl: async () => { executed = true; throw new Error('must not run codex'); }
      }),
      (error) => error.code === 'OPTIONS_UNSUPPORTED_BY_FALLBACK' && /imageModel/.test(error.message)
    );
    assert.equal(executed, false);
  }
});

test('warns when the server reports a different image model than requested', async (t) => {
  const { dir, config } = await fixture(t);
  const result = await createProvider(config).generateImage({
    prompt: 'x', model: 'gpt-5.6-sol', imageModel: flare, outputPath: path.join(dir, 'out.png'),
    fetchImpl: async () => new Response(JSON.stringify({
      tools: [{ type: 'image_generation', model: 'gpt-image-2-codex' }],
      output: [{ type: 'image_generation_call', result: png }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  assert.equal(result.requestedImageModel, flare);
  assert.equal(result.backendSettings.model, 'gpt-image-2-codex');
  assert.ok(result.warnings.some((warning) => /Requested image model.*but the backend reported/.test(warning)));
});

test('codex-cli rejects explicit and configured image models before running commands', async () => {
  for (const useDefault of [false, true]) {
    await assert.rejects(
      createProvider({ provider: 'codex-cli', ...(useDefault ? { defaultImageModel: flare } : {}) }).generateImage({
        prompt: 'x', ...(useDefault ? {} : { imageModel: flare }),
        execImpl: async () => { throw new Error('must not run codex'); }
      }),
      (error) => error.code === 'UNSUPPORTED_IMAGE_MODEL_SELECTION' && error.retryable === false
    );
  }
});
