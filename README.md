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

Aspect ratio and transparency:

```bash
cxi --prompt "a sunset over mountains" --size 2048x1152 --output ./sunset.png
cxi --prompt "a red maple leaf icon, centered" --transparent --output ./leaf.png
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
| `--size <value>` | aspect hint, **not** exact pixels — `auto`, `1024x1024`, `1536x1024`, `1024x1536`, `2048x2048`, `2048x1152`, `3840x2160`, `2160x3840` |
| `--transparent` | ask for a transparent background |
| `--model <name>` | orchestrator model — default `gpt-5.6-sol`; also `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4` |
| `--provider <name>` | `codex-http` (default), `codex-cli`, `auto` |
| `--dry-run` / `--debug` / `--debug-dir <path>` | diagnostics |

Environment overrides: `CODEX_HOME`, `CODEX_IMAGEN_BASE_URL`, `CODEX_IMAGEN_AUTH_FILE`,
`CODEX_IMAGEN_INSTALLATION_ID_FILE`, `CODEX_IMAGEN_GENERATED_IMAGES_DIR`,
`CODEX_IMAGEN_PROVIDER`, `CODEX_IMAGEN_MODEL`, `CODEX_IMAGEN_ORIGINATOR`, `CODEX_IMAGEN_OUTPUT`.

## How this backend actually behaves

**The tool-level `size`, `quality`, and `model` fields do nothing.** The backend
neither validates nor applies them — `size: "totally-bogus"` and a nonexistent
model name both return HTTP 200. The orchestrator model reads the prompt, picks
size, quality, and background itself, and echoes its choices back on the
`image_generation_call` item.

Measured on codex-cli 0.149.1 with the same landscape prompt:

| Tool field sent | Delivered |
|---|---|
| *(nothing)* | 1536×1024 |
| `size: 1024x1536` (portrait) | 1536×1024 — request ignored |
| `size: 1024x1024` (square) | 1536×1024 — request ignored |
| *(nothing)*, prompt says "tall 9:16" | 941×1672 — ratio 0.5628 vs 0.5625 |
| *(nothing)*, prompt says "square 1:1" | 1254×1254 |

So `--size` and `--transparent` are folded into the **prompt** rather than the
tool definition. Expect the right aspect ratio, not the exact pixel count — crop
or resize afterwards if the dimensions must be exact. Every run reports what was
actually delivered:

```json
"image": { "width": 941, "height": 1672, "hasAlpha": false },
"requestedSize": "2160x3840",
"backendSettings": { "size": "941x1672", "quality": "low", "background": "opaque" }
```

### Transparency

Transparency works — the model sets `background: "transparent"` on its own when
the prompt asks for an isolated subject, and the PNG comes back RGBA. What the
backend rejects is the literal `background` field on the tool definition:

```
invalid_value — Transparent background is not supported for this model.
```

That rejection is about the tool-config field, not the capability. `--transparent`
asks through the prompt instead and produces a genuinely transparent PNG
(measured: 99.9% transparent pixels, corner alpha 0).

`input_fidelity` is likewise rejected on the tool definition
(`The model 'gpt-image-2-codex' does not support the 'input_fidelity' parameter.`);
describe reference adherence in the prompt instead.

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

| Provider | Reference images | Aspect hint | Transparency |
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
  transparent: true
});

console.log(result.savedPath, result.image, result.backendSettings);
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
are all current. The inert tool fields documented above were measured against the
same version — re-check them after a Codex upgrade, since a later build may start
honoring `size` for real.

## License

MIT — see `LICENSE`.
