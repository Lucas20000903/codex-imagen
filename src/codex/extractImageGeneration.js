function normalizeSource(source) {
  if (Array.isArray(source)) {
    return { items: source, events: [], tools: [] };
  }
  const events = source?.events ?? [];
  const tools = source?.tools ?? [...events].reverse().find((event) =>
    Array.isArray(event?.data?.response?.tools)
  )?.data.response.tools ?? [];
  return { items: source?.items ?? [], events, tools };
}

/**
 * Pull any assistant text out of the turn. When the backend safety filter
 * declines a prompt the turn still completes with HTTP 200 and only a text
 * message, so this is what separates "refused" from "stream broke".
 *
 * @param {unknown[]} items
 * @returns {string | null}
 */
function extractAssistantText(items) {
  const chunks = [];

  for (const item of items) {
    if (item?.type !== 'message' || item?.role !== 'assistant') {
      continue;
    }
    for (const block of item?.content ?? []) {
      const text = block?.text ?? block?.output_text;
      if (typeof text === 'string' && text.trim()) {
        chunks.push(text.trim());
      }
    }
  }

  return chunks.length > 0 ? chunks.join('\n') : null;
}

/**
 * Extract the final image_generation_call output from parsed items or SSE events.
 *
 * @param {Array<unknown> | { items?: unknown[], events?: unknown[], tools?: unknown[] }} source
 * @returns {{ callId: string | undefined, revisedPrompt: string | null, resultBase64: string, partial: boolean, item: unknown }}
 */
export function extractImageGeneration(source) {
  const { items, events, tools } = normalizeSource(source);
  const reportedModel = tools.find((tool) => tool?.type === 'image_generation')?.model ?? null;

  const imageItem = [...items]
    .reverse()
    .find((item) => item?.type === 'image_generation_call' && item?.result);

  if (imageItem) {
    return {
      callId: imageItem.id,
      revisedPrompt: imageItem.revised_prompt ?? null,
      resultBase64: imageItem.result,
      partial: false,
      // Values reported by the backend, separate from the requested options.
      settings: {
        model: imageItem.model ?? reportedModel,
        size: imageItem.size ?? null,
        quality: imageItem.quality ?? null,
        background: imageItem.background ?? null
      },
      item: imageItem
    };
  }

  const partialImageEvent = [...events]
    .reverse()
    .find(
      (event) =>
        event?.data?.type === 'response.image_generation_call.partial_image' &&
        event?.data?.partial_image_b64
    );

  if (partialImageEvent) {
    return {
      callId: partialImageEvent.data.item_id,
      revisedPrompt: partialImageEvent.data.revised_prompt ?? null,
      resultBase64: partialImageEvent.data.partial_image_b64,
      partial: true,
      settings: { model: reportedModel, size: null, quality: null, background: null },
      item: {
        type: 'image_generation_call',
        id: partialImageEvent.data.item_id,
        status: 'completed',
        revised_prompt: partialImageEvent.data.revised_prompt ?? null,
        result: partialImageEvent.data.partial_image_b64
      }
    };
  }

  const assistantText = extractAssistantText(items);
  const error = new Error(
    assistantText
      ? `The turn completed without an image — the model answered with text instead. That means either the safety filter declined the prompt or the model did not read it as an image request:\n\n${assistantText}\n\nThe same prompt will produce the same answer, so rephrase it rather than retrying. If the subject may have tripped the filter, saying figures are clothed usually gets the composition through.`
      : 'The response stream completed without an image_generation_call result and without any assistant text. This is usually a transport problem rather than a refusal; retrying is reasonable.'
  );
  error.code = assistantText ? 'IMAGE_GENERATION_DECLINED' : 'MISSING_IMAGE_GENERATION_OUTPUT';
  error.retryable = !assistantText;
  error.assistantText = assistantText;
  throw error;
}
