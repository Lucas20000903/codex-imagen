import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRetry, retryDelayMs, withRetries } from '../src/retry.js';

function failure(props) {
  return Object.assign(new Error(props.message ?? 'boom'), props);
}

test('retries the failures a retry can actually fix', () => {
  assert.equal(classifyRetry(failure({ code: 'RATE_LIMITED' })), 'rate limited');
  assert.equal(classifyRetry(failure({ code: 'MISSING_IMAGE_GENERATION_OUTPUT' })), 'stream carried no image');
  assert.equal(classifyRetry(failure({ code: 'HTTP_ERROR', status: 503 })), 'HTTP 503');
  assert.equal(classifyRetry(failure({ message: 'fetch failed' })), 'transport failure');
});

test('gives up on failures that will repeat', () => {
  assert.equal(classifyRetry(failure({ code: 'IMAGE_GENERATION_DECLINED', retryable: false })), null);
  assert.equal(classifyRetry(failure({ code: 'UNAUTHORIZED' })), null);
  assert.equal(classifyRetry(failure({ code: 'HTTP_ERROR', status: 400 })), null);
  assert.equal(classifyRetry(failure({ code: 'UNSUPPORTED_IMAGE_SIZE', retryable: false })), null);
});

test('an explicit retryable flag wins over the code table', () => {
  assert.equal(classifyRetry(failure({ code: 'HTTP_ERROR', status: 400, retryable: true })), 'HTTP_ERROR');
});

test('backs off exponentially within bounds', () => {
  for (const attempt of [1, 2, 3, 8]) {
    const delay = retryDelayMs(attempt);
    assert.ok(delay > 0 && delay <= 20_000, `attempt ${attempt} gave ${delay}`);
  }
  assert.ok(retryDelayMs(3) > retryDelayMs(1));
});

test('returns the first success without sleeping', async () => {
  let slept = 0;
  const value = await withRetries(async () => 'ok', { retries: 3, sleep: async () => { slept += 1; } });
  assert.equal(value, 'ok');
  assert.equal(slept, 0);
});

test('retries up to the limit and then rethrows', async () => {
  let calls = 0;
  const reasons = [];

  await assert.rejects(
    withRetries(
      async () => {
        calls += 1;
        throw failure({ code: 'MISSING_IMAGE_GENERATION_OUTPUT' });
      },
      { retries: 2, sleep: async () => {}, onRetry: ({ reason }) => reasons.push(reason) }
    ),
    /boom/
  );

  assert.equal(calls, 3);
  assert.deepEqual(reasons, ['stream carried no image', 'stream carried no image']);
});

test('stops immediately on a failure that will repeat', async () => {
  let calls = 0;
  await assert.rejects(
    withRetries(
      async () => {
        calls += 1;
        throw failure({ code: 'IMAGE_GENERATION_DECLINED', retryable: false });
      },
      { retries: 5, sleep: async () => {} }
    ),
    /boom/
  );
  assert.equal(calls, 1);
});

test('recovers when a later attempt succeeds', async () => {
  let calls = 0;
  const value = await withRetries(
    async () => {
      calls += 1;
      if (calls < 3) throw failure({ message: 'fetch failed' });
      return 'recovered';
    },
    { retries: 3, sleep: async () => {} }
  );
  assert.equal(value, 'recovered');
  assert.equal(calls, 3);
});

test('never overshoots the delay ceiling, jitter included', () => {
  for (let i = 0; i < 500; i += 1) {
    for (const attempt of [6, 7, 8, 12]) {
      assert.ok(retryDelayMs(attempt) <= 20_000, `attempt ${attempt} exceeded the cap`);
    }
  }
});
