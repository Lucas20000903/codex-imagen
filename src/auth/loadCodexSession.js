import fs from 'node:fs/promises';

import { tokenSecondsLeft } from './jwt.js';

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Load Codex auth/session state from the local files on disk.
 *
 * @param {{ authFile: string, installationIdFile: string }} options
 * @returns {Promise<{ authFile: string, authMode: string | null, lastRefresh: string | null, accessToken: string | null, refreshToken: string | null, accountId: string | null, installationId: string | null, expiresInSeconds: number, raw: object }>}
 */
export async function loadCodexSession({ authFile, installationIdFile }) {
  let authRaw;
  try {
    authRaw = await fs.readFile(authFile, 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      const error = new Error(
        `No Codex auth state at ${authFile}. Sign in with \`codex login\` first — this tool never creates auth state on its own.`
      );
      error.code = 'MISSING_CODEX_AUTH';
      error.retryable = false;
      throw error;
    }
    throw cause;
  }

  const authJson = JSON.parse(authRaw);
  const tokens = authJson?.tokens ?? {};

  let installationId = null;
  try {
    installationId = normalizeString(await fs.readFile(installationIdFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const accessToken = normalizeString(tokens?.access_token);

  return {
    authFile,
    authMode: normalizeString(authJson?.auth_mode),
    lastRefresh: normalizeString(authJson?.last_refresh),
    accessToken,
    refreshToken: normalizeString(tokens?.refresh_token),
    accountId: normalizeString(tokens?.account_id),
    installationId,
    expiresInSeconds: tokenSecondsLeft(accessToken),
    raw: authJson
  };
}
