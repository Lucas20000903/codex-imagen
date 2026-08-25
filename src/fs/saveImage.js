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

const PNG_COLOR_TYPE_RGBA = 6;
const PNG_COLOR_TYPE_GRAY_ALPHA = 4;

/**
 * Read width, height, and alpha presence straight out of the PNG IHDR chunk,
 * which sits at a fixed offset. Requested dimensions mean nothing here, so the
 * delivered ones are worth reporting.
 *
 * @param {Buffer} bytes
 * @returns {{ width: number, height: number, hasAlpha: boolean } | null}
 */
export function describePng(bytes) {
  if (bytes.length < 26 || bytes.readUInt32BE(12) !== 0x49484452) {
    return null;
  }

  const colorType = bytes[25];
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: colorType === PNG_COLOR_TYPE_RGBA || colorType === PNG_COLOR_TYPE_GRAY_ALPHA
  };
}

/**
 * Decode a base64 PNG payload and save it to disk.
 *
 * @param {{ resultBase64: string, outputPath: string }} options
 * @returns {Promise<{ outputPath: string, width: number | null, height: number | null, hasAlpha: boolean | null }>}
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
  return { outputPath, ...(describePng(bytes) ?? { width: null, height: null, hasAlpha: null }) };
}
