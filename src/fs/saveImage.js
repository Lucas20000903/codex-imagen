import fs from 'node:fs/promises';
import path from 'node:path';

function assertStandardBase64(value) {
  if (/^data:/i.test(value)) {
    const error = new Error('Expected raw base64 PNG bytes, not a data URL.');
    error.code = 'UNSUPPORTED_DATA_URL';
    throw error;
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) {
    const error = new Error('Image payload is not standard base64.');
    error.code = 'INVALID_BASE64';
    throw error;
  }
}

/**
 * Decode a base64 PNG payload and save it to disk.
 *
 * @param {{ resultBase64: string, outputPath: string }} options
 * @returns {Promise<string>} The written output path.
 */
export async function saveImage({ resultBase64, outputPath }) {
  assertStandardBase64(resultBase64);

  const bytes = Buffer.from(resultBase64.trim(), 'base64');
  if (!bytes.length) {
    const error = new Error('Decoded image payload is empty.');
    error.code = 'EMPTY_IMAGE_PAYLOAD';
    throw error;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, bytes);
  return outputPath;
}
