function parseEventBlock(block) {
  let event = 'message';
  const dataLines = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const dataText = dataLines.join('\n');
  let data = null;
  if (dataText) {
    try {
      data = JSON.parse(dataText);
    } catch (cause) {
      const error = new Error(`Malformed SSE JSON payload for event ${event}: ${cause.message}`);
      error.code = 'MALFORMED_SSE_JSON';
      error.event = event;
      throw error;
    }
  }

  return { event, data, raw: block };
}

/**
 * Parse a full SSE response body into events, output items, and the response id.
 *
 * @param {string} text
 * @returns {{ events: unknown[], items: unknown[], responseId: string | null }}
 */
export function parseSseText(text) {
  const chunks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return summarizeEvents(chunks.map(parseEventBlock));
}

/**
 * Summarize already-parsed SSE events.
 *
 * @param {Array<{ event?: string, data?: { type?: string, response?: { id?: string }, item?: unknown } }>} events
 * @returns {{ events: unknown[], items: unknown[], responseId: string | null }}
 */
export function summarizeEvents(events) {
  const items = [];
  let responseId = null;

  for (const event of events) {
    const type = event?.data?.type;
    if (type === 'response.created' || type === 'response.completed') {
      responseId = event.data?.response?.id ?? responseId;
    }
    if (type === 'response.output_item.done' && event.data?.item) {
      items.push(event.data.item);
    }
  }

  return { events, items, responseId };
}
