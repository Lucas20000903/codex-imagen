import os from 'node:os';
import path from 'node:path';

import { DEFAULT_REFRESH_URL } from './auth/refreshSession.js';
import { CODEX_HTTP_PROVIDER } from './providers/providerTypes.js';

const DEFAULT_CODEX_HOME = path.join(os.homedir(), '.codex');

/** Roughly one empty stream per twenty calls was measured, so retry by default. */
export const DEFAULT_RETRIES = 2;
export const MAX_RETRIES = 10;

/**
 * Orchestrator models the Codex backend currently accepts. The first entry is
 * the default; older entries stay listed so pinning keeps working.
 */
export const KNOWN_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4'];

/**
 * Resolve the runtime configuration for the CLI/library.
 *
 * @param {{ codexHome?: string, baseUrl?: string, authFile?: string, installationIdFile?: string, generatedImagesDir?: string, provider?: string, defaultModel?: string, defaultImageModel?: string, originator?: string, defaultOutputPath?: string }} [overrides={}]
 * @returns {{ baseUrl: string, codexHome: string, authFile: string, installationIdFile: string, generatedImagesDir: string, provider: string, defaultModel: string, defaultImageModel: string | null, defaultOriginator: string, defaultOutputPath: string }}
 */
export function resolveConfig(overrides = {}) {
  const codexHome = overrides.codexHome || process.env.CODEX_HOME || DEFAULT_CODEX_HOME;

  return {
    baseUrl: overrides.baseUrl || process.env.CODEX_IMAGEN_BASE_URL || 'https://chatgpt.com/backend-api/codex',
    codexHome,
    authFile: overrides.authFile || process.env.CODEX_IMAGEN_AUTH_FILE || path.join(codexHome, 'auth.json'),
    installationIdFile:
      overrides.installationIdFile ||
      process.env.CODEX_IMAGEN_INSTALLATION_ID_FILE ||
      path.join(codexHome, 'installation_id'),
    generatedImagesDir:
      overrides.generatedImagesDir ||
      process.env.CODEX_IMAGEN_GENERATED_IMAGES_DIR ||
      path.join(codexHome, 'generated_images'),
    provider: overrides.provider || process.env.CODEX_IMAGEN_PROVIDER || CODEX_HTTP_PROVIDER,
    defaultModel: overrides.defaultModel || process.env.CODEX_IMAGEN_MODEL || process.env.CODEX_MODEL || KNOWN_MODELS[0],
    defaultImageModel: overrides.defaultImageModel || process.env.CODEX_IMAGEN_IMAGE_MODEL || null,
    defaultOriginator: overrides.originator || process.env.CODEX_IMAGEN_ORIGINATOR || 'codex_cli_rs',
    refresh: overrides.refresh !== false,
    refreshUrl:
      overrides.refreshUrl || process.env.CODEX_REFRESH_TOKEN_URL_OVERRIDE || DEFAULT_REFRESH_URL,
    retries: Number.isInteger(overrides.retries) ? overrides.retries : DEFAULT_RETRIES,
    defaultOutputPath:
      overrides.defaultOutputPath ||
      process.env.CODEX_IMAGEN_OUTPUT ||
      path.resolve(process.cwd(), `generated-${Date.now()}.png`)
  };
}

export const UNSUPPORTED_WARNING =
  'WARNING: This tool calls a private Codex backend path that is not a supported public API. The contract may break without notice.';
