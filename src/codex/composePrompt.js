/**
 * The Codex backend ignores the tool-level `size`, `quality`, `model`, and
 * `partial_images` fields — it accepts literal garbage in them and returns
 * HTTP 200 while the orchestrator model picks its own values from the prompt
 * and echoes the choices back on the image_generation_call item. So aspect and
 * transparency are steered through the prompt text instead.
 *
 * `output_format` is the one tool field that is genuinely honored, so it stays
 * on the tool definition rather than coming through here.
 */

/**
 * Total pixel area the backend delivers regardless of aspect: every measured
 * ratio landed within 0.04% of this, which is exactly 1536x1024. Higher
 * resolutions cannot be requested — only a different shape of the same area.
 */
export const FIXED_PIXEL_AREA = 1536 * 1024;

/** Reduced ratios small enough to name directly, e.g. "16:9" rather than "1.78:1". */
const MAX_NAMED_RATIO_TERM = 32;

const TRANSPARENT_HINT =
  'Place the subject on a fully transparent background with no backdrop, isolated, so the image keeps an alpha channel.';

function greatestCommonDivisor(a, b) {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * Parse `WxH`, `W:H`, or `auto` into a width/height pair.
 *
 * @param {string} value
 * @returns {{ width: number, height: number } | null} null for `auto`.
 */
export function parseSize(value) {
  if (!value || value === 'auto') {
    return null;
  }

  const match = /^(\d+)\s*[x:]\s*(\d+)$/i.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/**
 * Turn a width/height pair into the aspect wording the model responds to.
 *
 * @param {{ width: number, height: number }} size
 * @returns {string}
 */
export function describeAspect({ width, height }) {
  if (width === height) {
    return 'a perfectly square 1:1 composition';
  }

  const divisor = greatestCommonDivisor(width, height);
  const shortWidth = width / divisor;
  const shortHeight = height / divisor;
  const named = shortWidth <= MAX_NAMED_RATIO_TERM && shortHeight <= MAX_NAMED_RATIO_TERM;

  const landscape = width > height;
  const ratio = named
    ? `${shortWidth}:${shortHeight}`
    : landscape
      ? `${(width / height).toFixed(2)}:1`
      : `1:${(height / width).toFixed(2)}`;

  const shape = landscape ? 'landscape' : 'portrait';
  const extreme = landscape ? width / height >= 2 : height / width >= 2;

  return `${extreme ? 'an ultra-wide' : landscape ? 'a wide' : 'a tall'} ${ratio} ${shape} composition`;
}

/**
 * Fold aspect and transparency requests into the prompt text.
 *
 * @param {{ prompt: string, size?: string, transparent?: boolean }} options
 * @returns {string} The prompt actually sent to the backend.
 */
export function composePrompt({ prompt, size, transparent }) {
  const parts = [prompt.trim()];

  const parsed = parseSize(size);
  if (parsed) {
    parts.push(`Render it as ${describeAspect(parsed)}.`);
  }
  if (transparent) {
    parts.push(TRANSPARENT_HINT);
  }

  return parts.join(' ');
}
