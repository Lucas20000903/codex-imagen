import assert from 'node:assert/strict';
import test from 'node:test';

import { blockedFallbackOptions, createProvider } from '../src/providers/createProvider.js';

const config = {
  provider: 'auto',
  baseUrl: 'https://example.test/backend-api/codex',
  authFile: '/nonexistent/auth.json',
  installationIdFile: '/nonexistent/installation_id',
  generatedImagesDir: '/nonexistent/generated_images',
  defaultOriginator: 'codex_cli_rs',
  refresh: false
};

test('rejects an unknown provider name', () => {
  assert.throws(() => createProvider({ ...config, provider: 'nope' }), /Unsupported provider/);
});

test('names the options the codex-cli fallback would drop', () => {
  assert.deepEqual(blockedFallbackOptions({ size: '1024x1024' }), ['size']);
  assert.deepEqual(blockedFallbackOptions({ transparent: true }), ['transparent']);
  assert.deepEqual(blockedFallbackOptions({ images: ['a.png'] }), ['images']);
  assert.deepEqual(blockedFallbackOptions({ outputFormat: 'webp' }), ['outputFormat']);
});

test('lets a plain png request through, since the fallback can produce that', () => {
  assert.deepEqual(blockedFallbackOptions({ outputFormat: 'png' }), []);
  assert.deepEqual(blockedFallbackOptions({ images: [] }), []);
  assert.deepEqual(blockedFallbackOptions({}), []);
});

test('auto surfaces a non-retryable failure instead of falling back to codex-cli', async () => {
  // Missing credentials break the fallback the same way, so retrying there would
  // only swap one confusing error for another.
  await assert.rejects(
    createProvider(config).generateImage({ prompt: 'x', outputPath: '/tmp/x.png' }),
    /No Codex auth state/
  );
});
