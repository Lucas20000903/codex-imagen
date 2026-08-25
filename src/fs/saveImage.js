import fs from 'node:fs/promises';
import path from 'node:path';

function assertStandardBase64(value) {
  if (/^data:/i.test(value)) {
    const error = new Error('Expected raw base64 image bytes, not a data URL.');
    error.code = 'UNSUPPORTED_DATA_URL';
    throw error;
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(value)) {
    const error = new Error('Image payload is not standard base64.');
    error.code = 'INVALID_BASE64';
    throw error;
  }
}

const PNG_COLOR_TYPE_GRAY_ALPHA = 4;
const PNG_COLOR_TYPE_RGBA = 6;

function describePngBytes(bytes) {
  if (bytes.length < 26 || bytes.readUInt32BE(12) !== 0x49484452) {
    return null;
  }
  const colorType = bytes[25];
  return {
    format: 'png',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: colorType === PNG_COLOR_TYPE_RGBA || colorType === PNG_COLOR_TYPE_GRAY_ALPHA
  };
}

function describeJpegBytes(bytes) {
  // Walk the marker chain to the first start-of-frame, which carries the size.
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      return { format: 'jpeg', height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), hasAlpha: false };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return { format: 'jpeg', width: null, height: null, hasAlpha: false };
}

function describeWebpBytes(bytes) {
  const chunk = bytes.toString('ascii', 12, 16);

  if (chunk === 'VP8X' && bytes.length >= 30) {
    return {
      format: 'webp',
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
      hasAlpha: Boolean(bytes[20] & 0x10)
    };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { format: 'webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, hasAlpha: false };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return {
      format: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      hasAlpha: Boolean((bits >> 28) & 0x1)
    };
  }
  return { format: 'webp', width: null, height: null, hasAlpha: null };
}

/**
 * Read dimensions and alpha out of the delivered bytes. The requested size is
 * never authoritative here, so the delivered geometry is worth reporting.
 *
 * @param {Buffer} bytes
 * @returns {{ format: string, width: number | null, height: number | null, hasAlpha: boolean | null } | null}
 */
export function describeImage(bytes) {
  if (bytes.length < 16) {
    return null;
  }
  if (bytes.readUInt32BE(0) === 0x89504e47) {
    return describePngBytes(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return describeJpegBytes(bytes);
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return describeWebpBytes(bytes);
  }
  return null;
}

/**
 * Decode a base64 image payload and save it to disk.
 *
 * @param {{ resultBase64: string, outputPath: string }} options
 * @returns {Promise<{ outputPath: string, format: string | null, width: number | null, height: number | null, hasAlpha: boolean | null }>}
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
  return { outputPath, ...(describeImage(bytes) ?? { format: null, width: null, height: null, hasAlpha: null }) };
}
