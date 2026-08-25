import { tokenSecondsLeft } from './jwt.js';

/**
 * Validate the minimum session fields required to call the Codex backend.
 *
 * @param {{ authMode?: string | null, accessToken?: string | null, accountId?: string | null, installationId?: string | null }} session
 * @returns {{ warnings: string[] }}
 */
export function validateCodexSession(session) {
  const issues = [];
  const warnings = [];

  if (!session) {
    issues.push('Missing session object.');
  }

  if (session?.authMode && session.authMode !== 'chatgpt') {
    warnings.push(`auth_mode is ${session.authMode}; expected chatgpt for this backend path.`);
  }

  if (!session?.accessToken) {
    issues.push('Missing tokens.access_token in Codex auth state.');
  }

  if (!session?.accountId) {
    issues.push('Missing tokens.account_id in Codex auth state.');
  }

  if (!session?.installationId) {
    warnings.push('Missing installation_id; requests will omit x-codex-installation-id client metadata.');
  }

  // Expiry is handled by the refresh path, so only flag what refresh cannot fix.
  if (tokenSecondsLeft(session?.accessToken) <= 0 && !session?.refreshToken) {
    warnings.push('access token is expired and no refresh token is present; run `codex login`.');
  }

  if (issues.length > 0) {
    const error = new Error(`Invalid Codex session: ${issues.join(' ')}`);
    error.code = 'INVALID_CODEX_SESSION';
    error.issues = issues;
    error.warnings = warnings;
    throw error;
  }

  return { warnings };
}
