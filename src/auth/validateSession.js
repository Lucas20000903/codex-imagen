function decodeJwtPayload(token) {
  if (typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4 || 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

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

  const expiresAtSeconds = decodeJwtPayload(session?.accessToken)?.exp;
  if (typeof expiresAtSeconds === 'number' && expiresAtSeconds * 1000 <= Date.now()) {
    warnings.push(
      `access token appears expired at ${new Date(expiresAtSeconds * 1000).toISOString()}; run \`codex login\` if requests fail.`
    );
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
