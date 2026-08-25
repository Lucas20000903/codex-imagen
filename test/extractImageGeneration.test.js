import assert from 'node:assert/strict';
import test from 'node:test';

import { extractImageGeneration } from '../src/codex/extractImageGeneration.js';

test('returns the completed image item with the settings the backend chose', () => {
  const result = extractImageGeneration({
    items: [
      {
        type: 'image_generation_call',
        id: 'call_1',
        result: 'AAAA',
        revised_prompt: 'a leaf',
        size: '1254x1254',
        quality: 'medium',
        background: 'transparent'
      }
    ],
    events: []
  });

  assert.equal(result.resultBase64, 'AAAA');
  assert.equal(result.revisedPrompt, 'a leaf');
  assert.equal(result.partial, false);
  assert.deepEqual(result.settings, { size: '1254x1254', quality: 'medium', background: 'transparent' });
});

test('falls back to the last partial frame and flags it', () => {
  const result = extractImageGeneration({
    items: [],
    events: [
      { data: { type: 'response.image_generation_call.partial_image', item_id: 'call_1', partial_image_b64: 'BBBB' } }
    ]
  });

  assert.equal(result.resultBase64, 'BBBB');
  assert.equal(result.partial, true);
});

test('reports a text-only turn as a decline that will not survive a retry', () => {
  assert.throws(
    () =>
      extractImageGeneration({
        items: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: "I can't create that image." }] }],
        events: []
      }),
    (error) => {
      assert.equal(error.code, 'IMAGE_GENERATION_DECLINED');
      assert.equal(error.retryable, false);
      assert.match(error.message, /I can't create that image/);
      return true;
    }
  );
});

test('reports an empty turn as a retryable transport problem', () => {
  assert.throws(
    () => extractImageGeneration({ items: [], events: [] }),
    (error) => {
      assert.equal(error.code, 'MISSING_IMAGE_GENERATION_OUTPUT');
      assert.equal(error.retryable, true);
      return true;
    }
  );
});
