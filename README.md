# codex-imagen

Node.js library and CLI (`cxi`) that generates images through the Codex
ChatGPT session already signed in on your machine. No separate API key.

> **Not a supported public API.** This drives a private Codex backend path.
> The request contract can change without notice, and this tool is not
> affiliated with OpenAI.

## What it does

- Reuses the local Codex login from `~/.codex/auth.json` — never creates auth state
- Reads `~/.codex/installation_id` when present
- `POST`s to `https://chatgpt.com/backend-api/codex/responses` with the built-in
  `image_generation` tool
- Parses the SSE stream and writes the resulting PNG
- Falls back to driving `codex exec` when the HTTP path is unavailable
- Redacts every token, account id, and image payload from debug output

## Requirements

- Node.js 20+
- Codex CLI signed in with ChatGPT (`codex login`)
- An account entitled to image generation

## Install

```bash
npm install -g .        # from a clone
cxi --version
```

## Usage

```bash
cxi --prompt "flat blue square icon" --output ./out.png
```

Reference images — repeat `--image` for more than one:

```bash
cxi --prompt "Make this cat wear a hat" --image ./cat.png --output ./cat-hat.png
```

Size and quality:

```bash
cxi --prompt "a sunset over mountains" --size 1536x1024 --quality high --output ./sunset.png
```

Validate auth and print the request without calling the backend:

```bash
cxi --prompt "flat blue square icon" --dry-run
```

### Options

| Flag | Values |
|---|---|
| `--prompt <text>` | required |
| `--output <path>` | output PNG path |
| `--image <path>` | `png`, `jpg`/`jpeg`, `gif`, `webp` — repeatable |
| `--size <value>` | `auto`, `1024x1024`, `1536x1024`, `1024x1536`, `2048x2048`, `2048x1152`, `3840x2160`, `2160x3840` |
| `--quality <value>` | `auto`, `low`, `medium`, `high` |
| `--model <name>` | orchestrator model — default `gpt-5.6-sol`; also `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4` |
| `--image-model <name>` | image model override, e.g. `gpt-image-2` |
| `--provider <name>` | `codex-http` (default), `codex-cli`, `auto` |
| `--dry-run` / `--debug` / `--debug-dir <path>` | diagnostics |

Environment overrides: `CODEX_HOME`, `CODEX_IMAGEN_BASE_URL`, `CODEX_IMAGEN_AUTH_FILE`,
`CODEX_IMAGEN_INSTALLATION_ID_FILE`, `CODEX_IMAGEN_GENERATED_IMAGES_DIR`,
`CODEX_IMAGEN_PROVIDER`, `CODEX_IMAGEN_MODEL`, `CODEX_IMAGEN_ORIGINATOR`, `CODEX_IMAGEN_OUTPUT`.

## Known backend limits

The backend routes to `gpt-image-2-codex`, which rejects two options the public
Images API accepts. Both are refused locally with an explanation rather than
being sent and coming back as a bare HTTP 400:

| Option | Backend response |
|---|---|
| `background: transparent` | `Transparent background is not supported for this model.` |
| `input_fidelity` | `The model 'gpt-image-2-codex' does not support the 'input_fidelity' parameter.` |

Ask for a solid backdrop in the prompt instead of requesting transparency.

### Declined prompts

When the safety filter declines a prompt, the turn still returns HTTP 200 — it
just carries an assistant text message and no image. `cxi` reports that as
`IMAGE_GENERATION_DECLINED`, prints the model's own words, and marks it
non-retryable, because the identical prompt will be declined again. Rephrase and
retry once; for classical artwork, stating that figures are clothed is usually
enough.

An empty turn with no text at all is reported separately as
`MISSING_IMAGE_GENERATION_OUTPUT` and *is* worth retrying.

## Providers

| Provider | Reference images | Size | Quality |
|---|---|---|---|
| `codex-http` (default) | ✅ | ✅ | ✅ |
| `codex-cli` (`codex exec`, recovers the PNG from `~/.codex/generated_images/`) | ❌ | ❌ | ❌ |
| `auto` | falls back only when nothing would be silently dropped | | |

`auto` will not fall back after a declined prompt — the fallback would be
declined too, so the original guidance is surfaced instead.

## Library use

```js
import { createProvider, resolveConfig } from 'codex-imagen';

const config = resolveConfig({});
const result = await createProvider(config).generateImage({
  prompt: 'flat blue square icon',
  model: config.defaultModel,
  outputPath: './out.png',
  quality: 'high'
});

console.log(result.savedPath);
```

## Agent skill

`skills/codex-imagen/SKILL.md` follows the [Agent Skills](https://agentskills.io/specification)
format. Install it for Claude Code with:

```bash
mkdir -p ~/.claude/skills && cp -R skills/codex-imagen ~/.claude/skills/
```

## Development

```bash
npm test          # unit tests, no network
npm run smoke     # dry-run against local auth
```

## Compatibility

Verified against codex-cli **0.149.1**: auth schema, the `/responses` endpoint,
the `codex_cli_rs` originator, and the `codex exec` flags the fallback relies on
(`--ephemeral`, `--skip-git-repo-check`, `-s/--sandbox`, `-o/--output-last-message`)
are all current.

## License

MIT — see `LICENSE`.
