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
        model: 'gpt-image-2.5-flare',
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
  assert.deepEqual(result.settings, { model: 'gpt-image-2.5-flare', size: '1254x1254', quality: 'medium', background: 'transparent' });
});

test('leaves the model unknown when the backend does not report it', () => {
  const result = extractImageGeneration([{ type: 'image_generation_call', result: 'AAAA' }]);
  assert.equal(result.settings.model, null);
});

test('reads the image model from the response tools for SSE and JSON responses', () => {
  const items = [{ type: 'image_generation_call', result: 'AAAA' }];
  const tools = [{ type: 'image_generation', model: 'gpt-image-2-codex' }];
  assert.equal(extractImageGeneration({ items, tools }).settings.model, 'gpt-image-2-codex');
  const events = [
    { data: { type: 'response.created', response: { tools: [{ type: 'image_generation', model: 'earlier' }] } } },
    { data: { type: 'response.completed', response: { model: 'gpt-5.6-sol', tools } } }
  ];
  assert.equal(extractImageGeneration({ items, events }).settings.model, 'gpt-image-2-codex');
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
