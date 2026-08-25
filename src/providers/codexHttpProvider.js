import fs from 'node:fs/promises';
import path from 'node:path';

import { loadCodexSession } from '../auth/loadCodexSession.js';
import { validateCodexSession } from '../auth/validateSession.js';
import {
  buildResponsesRequest,
  sanitizeHeaders,
  sanitizeRequestBody
} from '../codex/buildResponsesRequest.js';
import { extractImageGeneration } from '../codex/extractImageGeneration.js';
import { parseSseText } from '../codex/streamResponsesSse.js';
import { saveImage } from '../fs/saveImage.js';

const REQUEST_TIMEOUT_MS = 300_000;

const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'x-oai-request-id',
  'x-codex-plan-type',
  'x-codex-active-limit',
  'x-models-etag'
]);

/**
 * Turn a non-2xx response into an error that says what to do about it. The
 * backend reports rejected tool options as `image_generation_user_error`, and
 * its message names the concrete parameter — worth surfacing verbatim.
 */
function classifyFailure({ status, body }) {
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Non-JSON error bodies fall through to the generic message below.
  }

  const backendMessage = parsed?.error?.message;
  const backendCode = parsed?.error?.code;

  if (status === 401) {
    const error = new Error('Unauthorized. The local ChatGPT session is likely expired — run `codex login` and retry.');
    error.code = 'UNAUTHORIZED';
    error.status = status;
    return error;
  }

  if (status === 429) {
    const error = new Error(`Rate limited by the Codex backend${backendMessage ? `: ${backendMessage}` : '.'}`);
    error.code = 'RATE_LIMITED';
    error.status = status;
    error.retryable = true;
    return error;
  }

  if (parsed?.error?.type === 'image_generation_user_error') {
    const error = new Error(`The image request was rejected: ${backendMessage}`);
    error.code = backendCode ? `IMAGE_OPTION_${String(backendCode).toUpperCase()}` : 'IMAGE_GENERATION_USER_ERROR';
    error.status = status;
    error.retryable = false;
    return error;
  }

  const error = new Error(
    `Codex backend request failed with HTTP ${status}${backendMessage ? `: ${backendMessage}` : '.'}`
  );
  error.code = 'HTTP_ERROR';
  error.status = status;
  error.body = body;
  return error;
}

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/"ChatGPT-Account-ID":"[^"]+"/g, '"ChatGPT-Account-ID":"[REDACTED_ACCOUNT_ID]"')
    .replace(/"session_id":"[^"]+"/g, '"session_id":"[REDACTED_SESSION_ID]"')
    .replace(/"x-codex-installation-id":"[^"]+"/g, '"x-codex-installation-id":"[REDACTED_INSTALLATION_ID]"')
    .replace(/"partial_image_b64":"[^"]+"/g, '"partial_image_b64":"[REDACTED_IMAGE_B64]"')
    .replace(/"result":"[^"]+"/g, '"result":"[REDACTED_IMAGE_B64]"');
}

function sanitizeResponseHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => SAFE_RESPONSE_HEADERS.has(key.toLowerCase()))
  );
}

function countEventTypes(events) {
  const counts = {};
  for (const event of events) {
    const key = event?.data?.type || event?.event || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function summarizeItems(items) {
  return items.map((item) => ({
    type: item?.type ?? 'unknown',
    status: item?.status ?? null,
    hasResult: Boolean(item?.result),
    hasRevisedPrompt: Boolean(item?.revised_prompt),
    role: item?.role ?? null
  }));
}

async function writeDebugArtifacts({ debugDir, request, responseStatus, responseHeaders, responseBody, parsed = null }) {
  if (!debugDir) {
    return;
  }

  await fs.mkdir(debugDir, { recursive: true });
  await fs.writeFile(
    path.join(debugDir, 'request.json'),
    JSON.stringify(
      { url: request.url, headers: sanitizeHeaders(request.headers), body: sanitizeRequestBody(request.body) },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(debugDir, 'response.json'),
    JSON.stringify(
      {
        status: responseStatus,
        headers: sanitizeResponseHeaders(responseHeaders),
        body: parsed
          ? {
              format: parsed.events.length > 0 ? 'sse' : 'json',
              responseIdPresent: Boolean(parsed.responseId),
              eventCounts: countEventTypes(parsed.events),
              items: summarizeItems(parsed.items)
            }
          : { format: 'unparsed', body: redactSecrets(responseBody) }
      },
      null,
      2
    )
  );
}

/**
 * Create a provider that talks directly to the Codex HTTP backend.
 *
 * @param {{ baseUrl: string, authFile: string, installationIdFile: string, defaultOriginator: string }} config
 * @returns {{ generateImage: (args: object) => Promise<object> }}
 */
export function createCodexHttpProvider(config) {
  return {
    async generateImage({
      prompt,
      model,
      outputPath,
      dryRun = false,
      debug = false,
      debugDir,
      fetchImpl = globalThis.fetch,
      images,
      size,
      transparent,
      outputFormat
    }) {
      const session = await loadCodexSession(config);
      const validation = validateCodexSession(session);
      const request = buildResponsesRequest({
        baseUrl: config.baseUrl,
        session,
        prompt,
        model,
        originator: config.defaultOriginator,
        images,
        size,
        transparent,
        outputFormat
      });

      if (dryRun) {
        return { mode: 'dry-run', warnings: validation.warnings, request: request.sanitized };
      }

      if (typeof fetchImpl !== 'function') {
        throw new Error('No fetch implementation is available in this Node runtime.');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response;
      try {
        response = await fetchImpl(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const responseHeaders = Object.fromEntries(response.headers.entries());
      const contentType = response.headers.get('content-type') || '';
      const responseBody = await response.text();

      if (!response.ok) {
        if (debug) {
          await writeDebugArtifacts({
            debugDir,
            request,
            responseStatus: response.status,
            responseHeaders,
            responseBody
          });
        }
        throw classifyFailure({ status: response.status, body: responseBody });
      }

      let parsed;
      try {
        const trimmed = responseBody.trimStart();
        const isSse =
          contentType.includes('text/event-stream') || trimmed.startsWith('event:') || trimmed.startsWith('data:');

        if (isSse) {
          parsed = parseSseText(responseBody);
        } else {
          const payload = JSON.parse(responseBody);
          parsed = {
            events: [],
            items: Array.isArray(payload?.output) ? payload.output : [],
            responseId: payload?.id ?? null
          };
        }
      } catch (error) {
        if (debug) {
          await writeDebugArtifacts({
            debugDir,
            request,
            responseStatus: response.status,
            responseHeaders,
            responseBody
          });
        }
        throw error;
      }

      if (debug) {
        await writeDebugArtifacts({
          debugDir,
          request,
          responseStatus: response.status,
          responseHeaders,
          responseBody,
          parsed
        });
      }

      const generation = extractImageGeneration(parsed);
      const saved = await saveImage({ resultBase64: generation.resultBase64, outputPath });

      const warnings = [...validation.warnings];
      if (generation.partial) {
        warnings.push('The final image item was missing; saved the last partial frame instead, which may be lower quality.');
      }

      return {
        mode: 'live',
        warnings,
        responseId: parsed.responseId,
        sessionId: request.sessionId,
        savedPath: saved.outputPath,
        image: { format: saved.format, width: saved.width, height: saved.height, hasAlpha: saved.hasAlpha },
        requestedSize: size ?? null,
        backendSettings: generation.settings,
        composedPrompt: request.composedPrompt,
        revisedPrompt: generation.revisedPrompt,
        request: request.sanitized,
        response: { status: response.status, headers: responseHeaders, itemCount: parsed.items.length }
      };
    }
  };
}
