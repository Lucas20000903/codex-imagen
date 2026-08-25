import { createCodexCliProvider } from './codexCliProvider.js';
import { createCodexHttpProvider } from './codexHttpProvider.js';
import { AUTO_PROVIDER, CODEX_CLI_PROVIDER, CODEX_HTTP_PROVIDER } from './providerTypes.js';

/** Options the codex-cli fallback cannot honor, so auto must not silently drop them. */
const HTTP_ONLY_OPTIONS = ['size', 'transparent', 'images'];

/** png is what the codex-cli fallback recovers, so only other formats block it. */
const NON_PNG = (value) => Boolean(value) && value !== 'png';

/**
 * Create the configured provider implementation.
 *
 * @param {{ provider: string, baseUrl?: string, authFile?: string, installationIdFile?: string, generatedImagesDir?: string, defaultOriginator?: string }} config
 * @returns {{ generateImage: (args: object) => Promise<object> }}
 */
export function createProvider(config) {
  const httpProvider = createCodexHttpProvider(config);
  const cliProvider = createCodexCliProvider(config);

  switch (config.provider) {
    case CODEX_HTTP_PROVIDER:
      return httpProvider;
    case CODEX_CLI_PROVIDER:
      return cliProvider;
    case AUTO_PROVIDER:
      return {
        async generateImage(args) {
          try {
            const result = await httpProvider.generateImage(args);
            return { ...result, provider: CODEX_HTTP_PROVIDER };
          } catch (httpError) {
            // A declined prompt is a verdict, not an outage — the fallback would
            // be declined too, so surface the original guidance instead.
            if (httpError?.retryable === false) {
              throw httpError;
            }

            const blocked = HTTP_ONLY_OPTIONS.filter((key) => {
              const value = args?.[key];
              return Array.isArray(value) ? value.length > 0 : Boolean(value);
            });
            if (NON_PNG(args?.outputFormat)) {
              blocked.push('outputFormat');
            }
            if (blocked.length > 0) {
              const error = new Error(
                `Auto cannot fall back to codex-cli because it cannot honor: ${blocked.join(', ')}.`
              );
              error.code = 'OPTIONS_UNSUPPORTED_BY_FALLBACK';
              error.cause = httpError;
              throw error;
            }

            const cliResult = await cliProvider.generateImage(args);
            return {
              ...cliResult,
              provider: CODEX_CLI_PROVIDER,
              warnings: [
                ...(cliResult.warnings || []),
                `The HTTP provider failed and auto fell back to codex-cli: ${httpError.code || httpError.message}`
              ]
            };
          }
        }
      };
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}
