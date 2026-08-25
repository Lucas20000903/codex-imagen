/**
 * Read a JWT payload without verifying it. The token is only inspected to see
 * how long it has left, so a signature check would buy nothing here.
 *
 * @param {unknown} token
 * @returns {object | null}
 */
export function decodeJwtPayload(token) {
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
 * Seconds until the access token expires. Infinity when the token carries no
 * expiry, so callers treat it as "no reason to refresh".
 *
 * @param {unknown} accessToken
 * @returns {number}
 */
export function tokenSecondsLeft(accessToken) {
  const exp = decodeJwtPayload(accessToken)?.exp;
  return typeof exp === 'number' ? Math.floor(exp - Date.now() / 1000) : Infinity;
}
