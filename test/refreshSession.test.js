import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadCodexSession } from '../src/auth/loadCodexSession.js';
import { refreshCodexSession, withAuthLock, writeAuthAtomic } from '../src/auth/refreshSession.js';

function jwt(expSecondsFromNow) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }))
    .toString('base64')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

async function authFixture(overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-imagen-auth-'));
  const authFile = path.join(dir, 'auth.json');
  await fs.writeFile(
    authFile,
    JSON.stringify({
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: 'old-id',
        access_token: jwt(-60),
        refresh_token: 'old-refresh',
        account_id: 'acct-1',
        ...overrides
      },
      last_refresh: '2026-01-01T00:00:00Z'
    }, null, 2)
  );
  return { dir, authFile, config: { authFile, installationIdFile: path.join(dir, 'installation_id') } };
}

function respond(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
}

test('rotates the tokens and keeps every unrelated field', async () => {
  const { dir, authFile, config } = await authFixture();

  const result = await refreshCodexSession({
    authFile,
    refreshToken: 'old-refresh',
    fetchImpl: respond(200, { id_token: 'new-id', access_token: jwt(3600), refresh_token: 'new-refresh' }),
    reload: () => loadCodexSession(config)
  });

  assert.equal(result.refreshed, true);
  const saved = JSON.parse(await fs.readFile(authFile, 'utf8'));
  assert.equal(saved.tokens.refresh_token, 'new-refresh');
  assert.equal(saved.tokens.id_token, 'new-id');
  assert.equal(saved.tokens.account_id, 'acct-1', 'account id must survive');
  assert.equal(saved.auth_mode, 'chatgpt', 'auth_mode must survive');
  assert.ok('OPENAI_API_KEY' in saved, 'unrelated keys must survive');
  assert.notEqual(saved.last_refresh, '2026-01-01T00:00:00Z');

  await fs.rm(dir, { recursive: true, force: true });
});

test('writes with owner-only permissions', async () => {
  const { dir, authFile } = await authFixture();
  await writeAuthAtomic(authFile, { tokens: { access_token: 'x' } });
  assert.equal((await fs.stat(authFile)).mode & 0o777, 0o600);
  await fs.rm(dir, { recursive: true, force: true });
});

test('leaves no temp files behind', async () => {
  const { dir, authFile } = await authFixture();
  await writeAuthAtomic(authFile, { tokens: { access_token: 'x' } });
  const leftovers = (await fs.readdir(dir)).filter((name) => name.includes('.tmp'));
  assert.deepEqual(leftovers, []);
  await fs.rm(dir, { recursive: true, force: true });
});

test('reports a rejected refresh token as needing a fresh login, not a retry', async () => {
  const { dir, authFile, config } = await authFixture();

  await assert.rejects(
    refreshCodexSession({
      authFile,
      refreshToken: 'old-refresh',
      fetchImpl: respond(401, { error: { code: 'refresh_token_expired' } }),
      reload: () => loadCodexSession(config)
    }),
    (error) => {
      assert.equal(error.code, 'REFRESH_FAILED');
      assert.equal(error.retryable, false);
      assert.match(error.message, /codex login/);
      return true;
    }
  );

  const untouched = JSON.parse(await fs.readFile(authFile, 'utf8'));
  assert.equal(untouched.tokens.refresh_token, 'old-refresh', 'a failed refresh must not damage the file');
  await fs.rm(dir, { recursive: true, force: true });
});

test('accepts a token another process rotated instead of forcing a re-login', async () => {
  const { dir, authFile, config } = await authFixture();

  const result = await refreshCodexSession({
    authFile,
    refreshToken: 'old-refresh',
    // Codex rotated the token first; the file already holds a usable one.
    reload: async () => ({ ...(await loadCodexSession(config)), expiresInSeconds: 3600 }),
    fetchImpl: respond(401, { error: { code: 'refresh_token_reused' } })
  });

  assert.equal(result.refreshed, false);
  assert.match(result.skipped, /rotated elsewhere/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('skips the network entirely when another process already refreshed', async () => {
  const { dir, authFile, config } = await authFixture();
  let called = 0;

  const result = await refreshCodexSession({
    authFile,
    refreshToken: 'stale-token-we-held',
    reload: async () => ({ ...(await loadCodexSession(config)), refreshToken: 'someone-elses-new', expiresInSeconds: 3600 }),
    fetchImpl: async () => { called += 1; throw new Error('should not be called'); }
  });

  assert.equal(called, 0);
  assert.equal(result.refreshed, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('refuses to refresh without a refresh token', async () => {
  const { dir, authFile, config } = await authFixture();
  await assert.rejects(
    refreshCodexSession({ authFile, refreshToken: null, reload: () => loadCodexSession(config) }),
    (error) => {
      assert.equal(error.code, 'NO_REFRESH_TOKEN');
      assert.equal(error.retryable, false);
      return true;
    }
  );
  await fs.rm(dir, { recursive: true, force: true });
});

test('serializes concurrent refreshes so only one rotation happens', async () => {
  const { dir, authFile } = await authFixture();
  const order = [];

  await Promise.all(
    [1, 2, 3].map((n) =>
      withAuthLock(authFile, async () => {
        order.push(`enter-${n}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`exit-${n}`);
      })
    )
  );

  for (let i = 0; i < order.length; i += 2) {
    assert.equal(order[i].replace('enter', ''), order[i + 1].replace('exit', ''), `overlap near ${order[i]}`);
  }
  assert.deepEqual((await fs.readdir(dir)).filter((f) => f.endsWith('.lock')), [], 'lock must be released');
  await fs.rm(dir, { recursive: true, force: true });
});
