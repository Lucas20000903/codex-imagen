import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { saveImage } from '../src/fs/saveImage.js';

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

  await saveImage({ resultBase64: Buffer.from('png-bytes').toString('base64'), outputPath });

  assert.equal(await fs.readFile(outputPath, 'utf8'), 'png-bytes');
  await fs.rm(dir, { recursive: true, force: true });
});
