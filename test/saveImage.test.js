import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { describeImage, saveImage } from '../src/fs/saveImage.js';

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
  assert.equal(saved.format, null);
  await fs.rm(dir, { recursive: true, force: true });
});

function fakePng({ width, height, colorType }) {
  const bytes = Buffer.alloc(26);
  bytes.writeUInt32BE(0x89504e47, 0); // PNG magic
  bytes.writeUInt32BE(0x49484452, 12); // "IHDR"
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[25] = colorType;
  return bytes;
}

test('reads dimensions and alpha out of the PNG header', () => {
  assert.deepEqual(describeImage(fakePng({ width: 1254, height: 1254, colorType: 6 })), {
    format: 'png',
    width: 1254,
    height: 1254,
    hasAlpha: true
  });
  assert.deepEqual(describeImage(fakePng({ width: 1536, height: 1024, colorType: 2 })), {
    format: 'png',
    width: 1536,
    height: 1024,
    hasAlpha: false
  });
});

test('reads a JPEG start-of-frame', () => {
  const bytes = Buffer.concat([
    Buffer.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0 segment to skip past
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0xe6, 0x04, 0xe6
    ]),
    Buffer.alloc(8) // scan data, so the marker walk has room to read the frame
  ]);
  assert.deepEqual(describeImage(bytes), { format: 'jpeg', width: 1254, height: 1254, hasAlpha: false });
});

test('reads a lossy WEBP header', () => {
  const bytes = Buffer.alloc(32);
  bytes.write('RIFF', 0, 'ascii');
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8 ', 12, 'ascii');
  bytes.writeUInt16LE(1254, 26);
  bytes.writeUInt16LE(1254, 28);
  assert.deepEqual(describeImage(bytes), { format: 'webp', width: 1254, height: 1254, hasAlpha: false });
});

test('returns null for bytes that are not an image it knows', () => {
  assert.equal(describeImage(Buffer.from('not an image at all, really not')), null);
});
