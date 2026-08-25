/**
 * The Codex backend ignores the tool-level `size`, `quality`, and `model`
 * fields — it accepts literal garbage there and returns HTTP 200 while the
 * orchestrator model picks its own values and echoes them back on the
 * image_generation_call item. The prompt is the only thing that actually steers
 * the output, so shape requests here instead of on the tool definition.
 */

/**
 * Aspect wording per listed size. Pixel dimensions are never guaranteed; the
 * model lands near the ratio, not on the exact numbers.
 */
const SIZE_HINTS = {
  auto: null,
  '1024x1024': 'a perfectly square 1:1 composition',
  '2048x2048': 'a perfectly square 1:1 composition',
  '1536x1024': 'a wide 3:2 landscape composition',
  '2048x1152': 'a wide 16:9 landscape composition',
  '3840x2160': 'a wide 16:9 landscape composition',
  '1024x1536': 'a tall 2:3 portrait composition',
  '2160x3840': 'a tall 9:16 portrait composition'
};

export const SUPPORTED_IMAGE_SIZES = new Set(Object.keys(SIZE_HINTS));

const TRANSPARENT_HINT =
  'Place the subject on a fully transparent background with no backdrop, isolated, so the PNG keeps an alpha channel.';

/**
 * Fold size and transparency requests into the prompt text.
 *
 * @param {{ prompt: string, size?: string, transparent?: boolean }} options
 * @returns {string} The prompt actually sent to the backend.
 */
export function composePrompt({ prompt, size, transparent }) {
  const parts = [prompt.trim()];

  const sizeHint = size ? SIZE_HINTS[size] : null;
  if (sizeHint) {
    parts.push(`Render it as ${sizeHint}.`);
  }
  if (transparent) {
    parts.push(TRANSPARENT_HINT);
  }

  return parts.join(' ');
}
