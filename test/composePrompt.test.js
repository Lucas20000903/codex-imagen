import assert from 'node:assert/strict';
import test from 'node:test';

import { aspectExtremity, composePrompt, describeAspect, parseSize } from '../src/codex/composePrompt.js';

test('parses both WxH and W:H, and treats auto as no hint', () => {
  assert.deepEqual(parseSize('1536x1024'), { width: 1536, height: 1024 });
  assert.deepEqual(parseSize('16:9'), { width: 16, height: 9 });
  assert.equal(parseSize('auto'), null);
  assert.equal(parseSize(undefined), null);
});

test('reports unparseable sizes as undefined rather than throwing', () => {
  for (const bad of ['huge', '1024', '0x100', '1024xabc']) {
    assert.equal(parseSize(bad), undefined, bad);
  }
});

test('names common ratios in lowest terms', () => {
  assert.match(describeAspect({ width: 1024, height: 1024 }), /square 1:1/);
  assert.match(describeAspect({ width: 1536, height: 1024 }), /wide 3:2 landscape/);
  assert.match(describeAspect({ width: 1024, height: 1536 }), /tall 2:3 portrait/);
  assert.match(describeAspect({ width: 3840, height: 2160 }), /wide 16:9 landscape/);
  assert.match(describeAspect({ width: 2560, height: 1440 }), /wide 16:9 landscape/);
});

test('calls ratios at or past 2:1 ultra-wide', () => {
  assert.match(describeAspect({ width: 2, height: 1 }), /ultra-wide 2:1 landscape/);
  assert.match(describeAspect({ width: 1, height: 2 }), /ultra-wide 1:2 portrait/);
});

test('falls back to a decimal ratio when lowest terms stay large', () => {
  assert.match(describeAspect({ width: 1915, height: 821 }), /2\.33:1/);
});

test('folds aspect and transparency into the prompt', () => {
  assert.equal(composePrompt({ prompt: 'a red leaf' }), 'a red leaf');
  assert.match(composePrompt({ prompt: 'a red leaf', size: '16:9' }), /wide 16:9 landscape/);
  assert.match(composePrompt({ prompt: 'a red leaf', transparent: true }), /fully transparent background/);

  const both = composePrompt({ prompt: 'a red leaf', size: '1024x1024', transparent: true });
  assert.match(both, /square 1:1/);
  assert.match(both, /transparent background/);
});

test('measures the longest-to-shortest edge ratio', () => {
  assert.equal(aspectExtremity({ width: 1024, height: 1024 }), 1);
  assert.equal(aspectExtremity({ width: 16, height: 9 }), 16 / 9);
  assert.equal(aspectExtremity({ width: 9, height: 16 }), 16 / 9);
});
