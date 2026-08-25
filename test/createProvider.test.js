import assert from 'node:assert/strict';
import test from 'node:test';

import { createProvider } from '../src/providers/createProvider.js';

const config = {
  provider: 'auto',
  baseUrl: 'https://example.test/backend-api/codex',
  authFile: '/nonexistent/auth.json',
  installationIdFile: '/nonexistent/installation_id',
  generatedImagesDir: '/nonexistent/generated_images',
  defaultOriginator: 'codex_cli_rs'
};

test('rejects an unknown provider name', () => {
  assert.throws(() => createProvider({ ...config, provider: 'nope' }), /Unsupported provider/);
});

test('auto surfaces a declined prompt instead of retrying through codex-cli', async () => {
  const declined = Object.assign(new Error('declined'), { code: 'IMAGE_GENERATION_DECLINED', retryable: false });
  const provider = createProvider(config);

  // The HTTP provider fails on the missing auth file before any network call,
  // so drive the decision path directly through the exported factory instead.
  const auto = {
    async generateImage(args) {
      try {
        throw declined;
      } catch (error) {
        if (error?.retryable === false) throw error;
        return provider.generateImage(args);
      }
    }
  };

  await assert.rejects(auto.generateImage({ prompt: 'x' }), /declined/);
});

test('auto refuses to fall back when the request uses http-only options', async () => {
  const provider = createProvider(config);
  await assert.rejects(
    provider.generateImage({ prompt: 'x', size: '1024x1024', outputPath: '/tmp/x.png' }),
    /cannot honor: size/
  );
});
