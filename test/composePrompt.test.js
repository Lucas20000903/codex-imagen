import assert from 'node:assert/strict';
import test from 'node:test';

import { composePrompt } from '../src/codex/composePrompt.js';

test('leaves a bare prompt alone', () => {
  assert.equal(composePrompt({ prompt: 'a red leaf' }), 'a red leaf');
});

test('folds a landscape size into an aspect instruction', () => {
  assert.equal(
    composePrompt({ prompt: 'a red leaf', size: '1536x1024' }),
    'a red leaf Render it as a wide 3:2 landscape composition.'
  );
});

test('folds a portrait size into an aspect instruction', () => {
  assert.match(composePrompt({ prompt: 'a red leaf', size: '2160x3840' }), /tall 9:16 portrait/);
});

test('adds nothing for size auto', () => {
  assert.equal(composePrompt({ prompt: 'a red leaf', size: 'auto' }), 'a red leaf');
});

test('asks for transparency explicitly', () => {
  assert.match(composePrompt({ prompt: 'a red leaf', transparent: true }), /fully transparent background/);
});

test('combines size and transparency', () => {
  const composed = composePrompt({ prompt: 'a red leaf', size: '1024x1024', transparent: true });
  assert.match(composed, /square 1:1/);
  assert.match(composed, /transparent background/);
});
