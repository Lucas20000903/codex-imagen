import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/** Codex's own OAuth client id, so the rotated token stays usable by Codex. */
export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const DEFAULT_REFRESH_URL = 'https://auth.openai.com/oauth/token';

/** Refresh this long before expiry rather than waiting for a 401 mid-request. */
export const REFRESH_SKEW_SECONDS = 5 * 60;

const REFRESH_TIMEOUT_MS = 120_000;
const LOCK_STALE_MS = 60_000;
const LOCK_POLL_MS = 150;
const LOCK_MAX_WAIT_MS = 30_000;

function isRefreshTokenReused(status, body) {
  if (status !== 401) {
    return false;
  }
  const text = String(body ?? '').toLowerCase();
  return text.includes('refresh_token_reused') || text.includes('already been used');
}

function refreshFailureMessage(status, body) {
  let code = null;
  try {
    const parsed = JSON.parse(body);
    code = parsed?.error?.code ?? (typeof parsed?.error === 'string' ? parsed.error : null);
  } catch {
    // Non-JSON bodies fall through to the generic message.
  }

  if (status === 401) {
    const detail =
      { refresh_token_expired: 'expired', refresh_token_reused: 'already used', refresh_token_invalidated: 'revoked' }[
        code
      ] ?? 'rejected';
    return `The Codex refresh token was ${detail}. Run \`codex login\` to sign in again.`;
  }
  return `Token refresh failed with HTTP ${status}. Run \`codex login\` if this persists.`;
}

/**
 * Hold an exclusive lock beside the auth file so two processes cannot rotate the
 * refresh token at the same time — the loser's token would be invalidated.
 *
 * @param {string} authFile
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withAuthLock(authFile, fn) {
  const lockPath = `${authFile}.codex-imagen.lock`;
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;

  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      try {
        return await fn();
      } finally {
        await handle.close().catch(() => undefined);
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      const stat = await fs.stat(lockPath).catch(() => null);
      if (!stat || Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(lockPath, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() > deadline) {
        const timeout = new Error(`Timed out waiting for the auth lock at ${lockPath}.`);
        timeout.code = 'AUTH_LOCK_TIMEOUT';
        throw timeout;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
}

/**
 * Replace the auth file in one step. A partial write here would cost the user
 * their Codex login, so the new content lands on a temp file first.
 *
 * @param {string} authFile
 * @param {object} authJson
 */
export async function writeAuthAtomic(authFile, authJson) {
  const tempPath = path.join(
    path.dirname(authFile),
    `.${path.basename(authFile)}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`
  );

  await fs.writeFile(tempPath, `${JSON.stringify(authJson, null, 2)}\n`, { mode: 0o600 });
  try {
    await fs.rename(tempPath, authFile);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await fs.chmod(authFile, 0o600).catch(() => undefined);
}

async function postRefresh(refreshUrl, refreshToken, fetchImpl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

  try {
    return await fetchImpl(refreshUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: CODEX_OAUTH_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Token refresh exceeded ${REFRESH_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fold refreshed tokens into the existing auth file, leaving every other field
 * exactly as Codex wrote it.
 */
function mergeTokens(authJson, refreshed) {
  const next = structuredClone(authJson);
  next.tokens = { ...(next.tokens ?? {}) };

  for (const key of ['id_token', 'access_token', 'refresh_token']) {
    if (refreshed[key]) {
      next.tokens[key] = refreshed[key];
    }
  }
  next.last_refresh = new Date().toISOString();
  return next;
}

/**
 * Rotate the Codex OAuth tokens and persist them.
 *
 * @param {{ authFile: string, refreshToken: string, refreshUrl?: string, fetchImpl?: typeof fetch, reload: () => Promise<object> }} options
 * @returns {Promise<{ refreshed: boolean, skipped: string | null }>}
 */
export async function refreshCodexSession({
  authFile,
  refreshToken,
  refreshUrl = DEFAULT_REFRESH_URL,
  fetchImpl = globalThis.fetch,
  reload
}) {
  if (!refreshToken) {
    const error = new Error(`No refresh token in ${authFile}. Run \`codex login\` to sign in again.`);
    error.code = 'NO_REFRESH_TOKEN';
    error.retryable = false;
    throw error;
  }

  return withAuthLock(authFile, async () => {
    // Codex or another copy of this tool may have rotated the token while we
    // queued on the lock; if so their fresh token is the one to keep.
    const current = await reload();
    if (current.refreshToken !== refreshToken && current.expiresInSeconds > REFRESH_SKEW_SECONDS) {
      return { refreshed: false, skipped: 'another process already refreshed' };
    }

    const response = await postRefresh(refreshUrl, current.refreshToken ?? refreshToken, fetchImpl);
    const body = await response.text();

    if (!response.ok) {
      // A reused token means someone else rotated it. Their access token is in
      // the file already, so use it instead of forcing a re-login.
      if (isRefreshTokenReused(response.status, body)) {
        const latest = await reload();
        if (latest.expiresInSeconds > 0) {
          return { refreshed: false, skipped: 'token was rotated elsewhere; using the current one' };
        }
      }
      const error = new Error(refreshFailureMessage(response.status, body));
      error.code = 'REFRESH_FAILED';
      error.status = response.status;
      error.retryable = false;
      throw error;
    }

    await writeAuthAtomic(authFile, mergeTokens(current.raw, JSON.parse(body)));
    return { refreshed: true, skipped: null };
  });
}
