import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { describePng, saveImage } from '../src/fs/saveImage.js';

test('rejects a data URL', async () => {
  await assert.rejects(
    saveImage({ resultBase64: 'data:image/png;base64,AAAA', outputPath: '/tmp/x.png' }),
    /not a data URL/
  );
});

test('rejects a payload that decodes to nothing', async () => {
  await assert.rejects(saveImage({ resultBase64: '   ', outputPath: '/tmp/x.png' }), /payload is empty/);
});

test('creates missing parent directories', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-imagen-test-'));
  const outputPath = path.join(dir, 'nested', 'deeper', 'out.png');

  const saved = await saveImage({ resultBase64: Buffer.from('png-bytes').toString('base64'), outputPath });

  assert.equal(await fs.readFile(outputPath, 'utf8'), 'png-bytes');
  assert.equal(saved.outputPath, outputPath);
  await fs.rm(dir, { recursive: true, force: true });
});

function fakePng({ width, height, colorType }) {
  const bytes = Buffer.alloc(26);
  bytes.writeUInt32BE(0x49484452, 12); // "IHDR"
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[25] = colorType;
  return bytes;
}

test('reads dimensions and alpha out of the PNG header', () => {
  assert.deepEqual(describePng(fakePng({ width: 1254, height: 1254, colorType: 6 })), {
    width: 1254,
    height: 1254,
    hasAlpha: true
  });
  assert.deepEqual(describePng(fakePng({ width: 1536, height: 1024, colorType: 2 })), {
    width: 1536,
    height: 1024,
    hasAlpha: false
  });
});

test('returns null for bytes that are not a PNG', () => {
  assert.equal(describePng(Buffer.from('not a png at all, really not')), null);
});
