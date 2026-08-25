import assert from 'node:assert/strict';
import test from 'node:test';

import { buildResponsesRequest } from '../src/codex/buildResponsesRequest.js';

const session = { accessToken: 'token-abc', accountId: 'account-123', installationId: 'install-xyz' };
const base = { baseUrl: 'https://example.test/backend-api/codex', session, model: 'gpt-5.6-sol', originator: 'codex_cli_rs' };

test('rejects an empty prompt', () => {
  assert.throws(() => buildResponsesRequest({ ...base, prompt: '   ' }), /Prompt is required/);
});

test('accepts any parseable aspect, including ratios off the official list', () => {
  for (const size of ['800x600', '21:9', '2560x1440']) {
    assert.doesNotThrow(() => buildResponsesRequest({ ...base, prompt: 'x', size }), size);
  }
});

test('rejects a size it cannot read an aspect from', () => {
  assert.throws(() => buildResponsesRequest({ ...base, prompt: 'x', size: 'huge' }), /Cannot read an aspect ratio/);
});

test('puts the output format on the tool, since the backend honors it', () => {
  const { body } = buildResponsesRequest({ ...base, prompt: 'x', outputFormat: 'webp' });
  assert.deepEqual(body.tools[0], { type: 'image_generation', output_format: 'webp' });
});

test('rejects an output format the backend does not produce', () => {
  assert.throws(() => buildResponsesRequest({ ...base, prompt: 'x', outputFormat: 'tiff' }), /Unsupported output format/);
});

test('rejects tool options the Codex image model refuses', () => {
  assert.throws(
    () => buildResponsesRequest({ ...base, prompt: 'x', toolOptions: { background: 'transparent' } }),
    /does not support a transparent/
  );
});

test('never puts size on the tool, because the backend discards it', () => {
  const { body } = buildResponsesRequest({ ...base, prompt: 'a leaf', size: '1536x1024' });
  assert.deepEqual(body.tools[0], { type: 'image_generation', output_format: 'png' });
});

test('steers size and transparency through the prompt instead', () => {
  const { body, composedPrompt } = buildResponsesRequest({
    ...base,
    prompt: 'a leaf',
    size: '1536x1024',
    transparent: true
  });

  assert.match(composedPrompt, /3:2 landscape/);
  assert.match(composedPrompt, /transparent background/);
  assert.equal(body.input[0].content[0].text, composedPrompt);
});

test('appends reference images as input_image blocks', () => {
  const { body } = buildResponsesRequest({ ...base, prompt: 'a leaf', images: ['data:image/png;base64,AAA'] });
  assert.equal(body.input[0].content.length, 2);
  assert.equal(body.input[0].content[1].type, 'input_image');
});

test('redacts every secret from the sanitized copy', () => {
  const { sanitized } = buildResponsesRequest({ ...base, prompt: 'a leaf', images: ['data:image/png;base64,AAA'] });
  const serialized = JSON.stringify(sanitized);

  assert.equal(sanitized.headers.Authorization, 'Bearer [REDACTED]');
  assert.ok(!serialized.includes('token-abc'));
  assert.ok(!serialized.includes('account-123'));
  assert.ok(!serialized.includes('install-xyz'));
  assert.ok(!serialized.includes('base64,AAA'));
});

test('joins the responses path onto a base url without a trailing slash', () => {
  const { url } = buildResponsesRequest({ ...base, prompt: 'a leaf' });
  assert.equal(url, 'https://example.test/backend-api/codex/responses');
});

test('request-shape errors carry a code so the CLI can print one line', () => {
  for (const [args, code] of [
    [{ prompt: '' }, 'MISSING_PROMPT'],
    [{ prompt: 'x', size: 'huge' }, 'UNPARSEABLE_IMAGE_SIZE'],
    [{ prompt: 'x', outputFormat: 'tiff' }, 'UNSUPPORTED_OUTPUT_FORMAT'],
    [{ prompt: 'x', toolOptions: { input_fidelity: 'high' } }, 'UNSUPPORTED_TOOL_OPTION']
  ]) {
    assert.throws(
      () => buildResponsesRequest({ ...base, ...args }),
      (error) => {
        assert.equal(error.code, code);
        assert.equal(error.retryable, false);
        return true;
      }
    );
  }
});
