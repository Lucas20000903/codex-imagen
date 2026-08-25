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
cxi --prompt "a sunset over mountains" --size 16:9 --output ./sunset.png
cxi --prompt "a red maple leaf icon, centered" --transparent --output ./leaf.png
cxi --prompt "a bicycle" --size 16:9 --format webp --output ./bike.webp
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
| `--size <value>` | aspect ratio as `WxH`, `W:H`, or `auto` — sets the shape, **not** the pixel count |
| `--transparent` | ask for a transparent background |
| `--format <name>` | `png` (default), `jpeg`, `webp` |
| `--model <name>` | orchestrator model — default `gpt-5.6-sol`; also `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4` |
| `--provider <name>` | `codex-http` (default), `codex-cli`, `auto` |
| `--dry-run` / `--debug` / `--debug-dir <path>` | diagnostics |

Environment overrides: `CODEX_HOME`, `CODEX_IMAGEN_BASE_URL`, `CODEX_IMAGEN_AUTH_FILE`,
`CODEX_IMAGEN_INSTALLATION_ID_FILE`, `CODEX_IMAGEN_GENERATED_IMAGES_DIR`,
`CODEX_IMAGEN_PROVIDER`, `CODEX_IMAGEN_MODEL`, `CODEX_IMAGEN_ORIGINATOR`, `CODEX_IMAGEN_OUTPUT`.

## How this backend actually behaves

Measured against codex-cli 0.149.1. Of the options the public Images API exposes,
this path honors almost none of them:

| Tool field | Honored? | Evidence |
|---|---|---|
| `output_format` | **yes** | `png` 840KB, `jpeg` 59KB, `webp` 639KB — all valid files |
| `size` | no | `size: "totally-bogus"` returns HTTP 200; the value is never applied |
| `quality` | no | echoed back as the model's own pick regardless of what is sent |
| `model` | no | a nonexistent model name returns HTTP 200 |
| `partial_images` | no | `0` and `3` both yield exactly one partial event |
| `moderation` | accepted | no measurable effect |
| `background` | rejected | `transparent` returns HTTP 400 — see below |
| `input_fidelity` | rejected | `gpt-image-2-codex` refuses the parameter |

The orchestrator model reads the prompt, picks size/quality/background itself,
and echoes its choices on the `image_generation_call` item. So `--size` and
`--transparent` are folded into the **prompt**; only `--format` rides on the tool.

### Resolution is fixed; only the shape changes

Every image comes back at **~1,572,864 pixels — exactly 1536x1024** — reshaped to
whatever ratio the prompt asks for. Eleven measured ratios, all within 0.04% of
that area:

| Ratio | Delivered | Pixels | vs 1536x1024 |
|---|---|---|---|
| 1:1 | 1254x1254 | 1,572,516 | 99.98% |
| 5:4 | 1402x1122 | 1,573,044 | 100.01% |
| 4:3 | 1448x1086 | 1,572,528 | 99.98% |
| 3:2 | 1536x1024 | 1,572,864 | 100.00% |
| 16:9 | 1672x941 | 1,573,352 | 100.03% |
| 2:1 | 1774x887 | 1,573,538 | 100.04% |
| 21:9 | 1915x821 | 1,572,215 | 99.96% |
| 3:4 | 1086x1448 | 1,572,528 | 99.98% |
| 2:3 | 1024x1536 | 1,572,864 | 100.00% |
| 9:16 | 941x1672 | 1,573,352 | 100.03% |
| 1:2 | 887x1774 | 1,573,538 | 100.04% |

Consequences worth knowing before promising anything:

- **The aspect ratio is reliable.** Any ratio works, including ones absent from
  the official size menu (21:9, 2:1, 5:4). Worst observed error was 0.1%.
- **2K and 4K are unreachable.** The official menu lists 2560x1440 (3.7 MP) and
  3840x2160 (8.3 MP); this path caps out at 1.57 MP. Asking for "4K ultra HD"
  changes the ratio to 16:9 and nothing else.
- **Quality does not scale resolution.** Sending `quality: high`, or asking for
  it in the prompt, leaves the area at 100.0% and the echoed quality at `low`.
  File size moves (853KB–1410KB) but that is compression, not pixels.
- **Exact pixel counts are not on offer.** Two requests happened to land on
  1536x1024 and 1024x1536 exactly, because those *are* the native area at those
  ratios. Nothing else will.

### Transparency

Transparency works — the model sets `background: "transparent"` on its own when
the prompt asks for an isolated subject, and the image comes back with an alpha
channel. What the backend rejects is the literal `background` field on the tool
definition:

```
invalid_value — Transparent background is not supported for this model.
```

That rejection is about the tool-config field, not the capability. `--transparent`
asks through the prompt instead and produces genuine transparency (measured:
99.9% transparent pixels, corner alpha 0).

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

| Provider | Reference images | Aspect | Transparency | jpeg/webp |
|---|---|---|---|---|
| `codex-http` (default) | ✅ | ✅ | ✅ | ✅ |
| `codex-cli` (`codex exec`, recovers the PNG from `~/.codex/generated_images/`) | ❌ | ❌ | ❌ | ❌ |
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
  size: '16:9',
  transparent: true,
  outputFormat: 'webp'
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
honoring `size` for real, or lift the 1.57 MP ceiling.

## License

MIT — see `LICENSE`.
