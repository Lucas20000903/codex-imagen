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
npm install -g github:Lucas20000903/codex-imagen
cxi --version
```

From a clone, `npm install -g .` (or `npm link` while developing). To try it
without installing, put `npx -y github:Lucas20000903/codex-imagen` where the
examples say `cxi`.

A global install lives under the active Node version's prefix, so switching
versions with fnm or nvm hides `cxi` until it is installed again for that
version.

## Usage

```bash
cxi --prompt "flat blue square icon" --output ./out.png
```

### Image model selection

Request an image model separately from the orchestrator (`--model`):

```bash
cxi --image-model gpt-image-2.5-flare --prompt "a blue leaf icon" --output ./flare.png
cxi --image-model gpt-image-2.5-sunburst --prompt "a blue leaf icon" --output ./sunburst.png
```

This forwards `model` on the `image_generation` tool.
`CODEX_IMAGEN_IMAGE_MODEL` sets the default; `--image-model` overrides it.
Omitting both keeps the server's default choice.

**Requesting a model does not prove the server used it.** On 2026-09-15, the
default request returned `gpt-image-2-codex` in `response.tools[0].model`.
Explicit `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst` requests also returned
`gpt-image-2-codex`, including runs of both models with orchestrator `gpt-5.5`.
The CLI now reports `requestedImageModel` separately from
`backendSettings.model`, and warns when they differ. If the response does not
identify the image model, `backendSettings.model` is `null`.

These runs verify client-side forwarding, but do not confirm that this server
uses Images 2.5. See the [live verification record](docs/verification-2026-09-15.md).

A separate [latency comparison](docs/flare-sunburst-benchmark-2026-09-15.md)
used the same prompt and `gpt-5.5`, with three sequential runs per selection.
Flare averaged 30.03s and Sunburst 27.86s; medians were 27.70s and 27.97s.
These small samples did not demonstrate a consistent Flare speed advantage.

Model selection requires `codex-http`. `codex-cli` rejects it, and `auto` will
not fall back if that would discard the selection.

### Reference images and output

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
| `--model <name>` | orchestrator model — default `gpt-5.6-sol`; also `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`. All five verified live; unknown names are rejected with HTTP 400 |
| `--image-model <name>` | requested image model, e.g. `gpt-image-2.5-flare` or `gpt-image-2.5-sunburst`; defaults to the server's choice |
| `--provider <name>` | `codex-http` (default), `codex-cli`, `auto` |
| `--retries <n>` | retry transient failures (default 2, max 10) |
| `--no-retry` | do not retry |
| `--no-refresh` | do not rotate the Codex OAuth token |
| `--refresh-url <url>` | override the OAuth token endpoint |
| `--dry-run` / `--debug` / `--debug-dir <path>` | diagnostics |

Environment overrides: `CODEX_HOME`, `CODEX_IMAGEN_BASE_URL`, `CODEX_IMAGEN_AUTH_FILE`,
`CODEX_IMAGEN_INSTALLATION_ID_FILE`, `CODEX_IMAGEN_GENERATED_IMAGES_DIR`,
`CODEX_IMAGEN_PROVIDER`, `CODEX_IMAGEN_MODEL`, `CODEX_IMAGEN_IMAGE_MODEL`,
`CODEX_IMAGEN_ORIGINATOR`, `CODEX_IMAGEN_OUTPUT`.

## Transparent reference images: 2026-09-15 check

A transparent reference alone did **not** preserve transparency in the tested
color edit: it returned RGB with an opaque background. With `--transparent`
and an explicit request to preserve the transparent background, the edit
returned RGBA with 81.20% fully transparent pixels. Creating a new icon in the
reference's style with an explicit transparency request also worked (81.43%).

Each condition was tested once, and all runs reported `gpt-image-2-codex`.
An alpha channel alone is not proof of transparency; these results were checked
for actual alpha values below 255. Exact prompts and measurements are in the
[verification record](docs/verification-2026-09-15.md).

## Backend measurements from 2026-08-25

These observations describe the default `gpt-image-2-codex` route at that time.
They do not establish Images 2.5 capabilities. `cxi` still steers size and
transparency through the prompt and enforces its 3:1 aspect limit; this change
adds image model selection, not resolution or quality controls.

Measured 2026-08-25 against codex-cli 0.149.1 with the bundled imagegen skill
stamped 2026-08-25 08:53 KST. **Pin both numbers.** The system skill at
`$CODEX_HOME/skills/.system/imagegen/` updates independently of the CLI binary —
here it moved a day after the CLI did — and it is the skill, not the CLI version,
that governs the behavior below.

Of the options the public Images API exposes, this path honors almost none:

| Tool field | Honored? | Evidence |
|---|---|---|
| `output_format` | **yes** | `png` 840KB, `jpeg` 59KB, `webp` 639KB — all valid files |
| `size` | no | `size: "totally-bogus"` returns HTTP 200; the value is never applied |
| `quality` | no | echoed back as the model's own pick regardless of what is sent |
| `model` (on the tool) | no | a nonexistent model name returns HTTP 200 |
| `model` (top-level) | **yes** | unknown names are rejected with HTTP 400 |
| `partial_images` | no | `0` and `3` both yield exactly one partial event |
| `moderation` | accepted | no measurable effect |
| `background` | rejected | `transparent` returns HTTP 400 — see below |
| `input_fidelity` | rejected | `gpt-image-2-codex` refuses the parameter |

The orchestrator model reads the prompt, picks size/quality/background itself,
and echoes its choices on the `image_generation_call` item. So `--size` and
`--transparent` are folded into the **prompt**. The CLI now sends `--image-model`
on the tool alongside `--format`; check the reported model as described above.

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

Ratios hold precisely right up to a wall at 3:1, which is exactly the documented
gpt-image-2 limit on longest-to-shortest edge:

| Requested | Delivered | Error |
|---|---|---|
| 4:5, 1:1, 5:4, 4:3, 3:2, 16:9, 2:1 | on the nose | 0.0–0.1% |
| 21:9 (2.33) | 1915x821 | 0.0% |
| 12:5 (2.40) | 1942x809 | 0.0% |
| 5:2 (2.50) | 1983x793 | 0.0% |
| 11:4 (2.75) | 2079x756 | 0.0% |
| 1:3 (0.333) | 736x2135 | 3.4% |
| 3:1 | 1881x836 (2.25) | **25%** |
| 4:1 | 1983x793 (2.50) | **37%** |
| 1:4 | 793x1983 (0.40) | **60%** |

`cxi` refuses anything past 3:1 rather than returning a different shape in
silence, and warns whenever the delivered ratio drifts more than 5% from the
request.

Consequences worth knowing before promising anything:

- **The aspect ratio is reliable within 3:1.** Any ratio in range works,
  including ones absent from the official size menu (21:9, 5:2, 11:4, 5:4).
- **2K and 4K are unreachable *on this path*.** They exist, but only through the
  OpenAI Images API with an `OPENAI_API_KEY`, which is billed separately — see
  "The other path" below. Asking for "4K ultra HD" here changes the ratio to 16:9
  and nothing else.
- **Quality does not scale resolution.** Sending `quality: high`, or asking for
  it in the prompt, leaves the area at 100.0% and the echoed quality at `low`.
  File size moves (853KB–1410KB) but that is compression, not pixels.
- **Exact pixel counts are not on offer.** Two requests happened to land on
  1536x1024 and 1024x1536 exactly, because those *are* the native area at those
  ratios. Nothing else will.

### The sibling `/images/*` endpoints

The Codex backend also exposes `images/generations` and `images/edits`, reachable
with the same ChatGPT session and shaped like the public Images API
(`{prompt, model, size, quality, background, n}`, replies carrying
`data[].b64_json`). `images/edits` genuinely edits — hand it a reference and the
shape, linework, and composition survive while the requested change lands.

They are not worth switching to. Measured on the same fixed prompt, they honor
*less* than `/responses` does and fail silently instead of loudly:

| Field | `/responses` | `/images/generations` |
|---|---|---|
| `output_format` | **honored** | ignored — `webp` returns PNG |
| `size` | ignored | ignored — `2048x2048` returns 1254x1254 |
| `quality` | ignored | ignored |
| `background` | HTTP 400 | HTTP 200, then ignored |
| `n` | — | ignored — `n: 2` returns one image |
| Resolution | ~1.57 MP | ~1.57 MP |

Beware the trap that `background` sets here: on an isolated-subject prompt the
result *is* transparent, which looks like the parameter working. It is not —
sending `background: "auto"` on that same prompt is equally transparent, and
sending `background: "transparent"` on a scene prompt comes back opaque. The
prompt is doing the work on both endpoints.

### The other path

Codex ships an official image skill at
`$CODEX_HOME/skills/.system/imagegen/`, and its docs explain why the tool fields
above are inert: they are *"fallback-only execution controls. Do not assume they
are built-in `image_gen` tool arguments."* There are two separate surfaces:

| | Built-in tool (what `cxi` uses) | OpenAI Images API |
|---|---|---|
| Auth | the local ChatGPT session | `OPENAI_API_KEY`, billed separately |
| Endpoint | `/backend-api/codex/responses` | `POST /v1/images/generations` |
| size / quality | not arguments; prompt only | real parameters |
| Resolution | fixed ~1.57 MP | 655,360–8,294,400 px, so 2K and 4K |
| Transparency | **works, via the prompt** | `gpt-image-2` refuses it; needs `gpt-image-1.5` |

Worth noting the last row: the built-in path is the *better* one for transparency.
Codex's own fallback CLI hard-stops before the network on
`--model gpt-image-2 --background transparent`, telling you to drop to
`gpt-image-1.5`. Through the prompt, `gpt-image-2-codex` simply returns alpha.

If you need true 2K/4K, that is the API path with your own key — this tool does
not wrap it.

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

Native transparency is **new as of the 2026-08-25 skill update**, which is worth
knowing before assuming it was always there. On this machine, 14 images generated
by Codex itself between 2026-05-13 and 2026-08-18 are RGB with no alpha channel;
the first RGBA output appears seven minutes after the skill was restamped. If a
build predating that update is in play, expect opaque results and say so rather
than promising a cutout.

### Declined prompts

When the safety filter declines a prompt, the turn still returns HTTP 200 — it
just carries an assistant text message and no image. `cxi` reports that as
`IMAGE_GENERATION_DECLINED`, prints the model's own words, and marks it
non-retryable, because the identical prompt will be declined again. Rephrase and
retry once; for classical artwork, stating that figures are clothed is usually
enough.

An empty turn with no text at all is reported separately as
`MISSING_IMAGE_GENERATION_OUTPUT` and *is* worth retrying.

## Staying signed in

Codex access tokens expire in days, so a tool that only reads `auth.json` stops
working without warning. `cxi` rotates them the way Codex does:

- refreshes when under five minutes remain, before the request goes out
- refreshes once more and retries if the backend still answers 401
- takes a lock beside `auth.json` so two processes cannot rotate at once, since
  the loser's refresh token would be invalidated
- writes through a temp file and `rename`, at mode `0600`, preserving every
  field it did not set — a half-written `auth.json` would cost you your login
- when another process rotated first, adopts that token instead of forcing a
  re-login

`--no-refresh` turns all of it off and leaves the file untouched.

A refresh token that is genuinely expired or revoked cannot be rescued; `cxi`
says so and points at `codex login` rather than retrying.

## Retries

Roughly one call in twenty returns HTTP 200 with no image at all — measured over
twenty timed runs. That is a transient stream failure, not a refusal, so `cxi`
retries it twice by default with exponential backoff and jitter.

It retries only what a retry can fix: empty streams, 5xx, 429, malformed stream
frames, and transport errors. It never retries a declined prompt, a malformed
request, or dead credentials — those fail identically every time, and retrying
just spends your quota to reach the same message.

## Providers

| Provider | Reference images | Aspect | Transparency | jpeg/webp | Image model request |
|---|---|---|---|---|---|
| `codex-http` (default) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `codex-cli` (`codex exec`, recovers the PNG from `~/.codex/generated_images/`) | ❌ | ❌ | ❌ | ❌ | ❌ |
| `auto` | falls back only when nothing would be silently dropped | | | | |

`auto` will not fall back after a declined prompt — the fallback would be
declined too, so the original guidance is surfaced instead.

## Library use

```js
import { createProvider, resolveConfig } from 'codex-imagen';

const config = resolveConfig({});
const result = await createProvider(config).generateImage({
  prompt: 'flat blue square icon',
  model: config.defaultModel,
  imageModel: 'gpt-image-2.5-flare',
  outputPath: './out.webp',
  size: '16:9',
  transparent: true,
  outputFormat: 'webp'
});

console.log(result.savedPath, result.image, result.backendSettings);
```

Use `resolveConfig({ defaultImageModel: 'gpt-image-2.5-flare' })` to set a
library default. A per-call `imageModel` overrides it. Inspect
`result.requestedImageModel`, `result.backendSettings.model`, and
`result.warnings` to check what the server reported.

## Agent skill

`skills/codex-imagen/SKILL.md` follows the [Agent Skills](https://agentskills.io/specification)
format. Install it for Claude Code, Codex, Cursor, and other agents with the
[skills CLI](https://github.com/vercel-labs/skills):

```bash
npx skills add Lucas20000903/codex-imagen
```

This installs only the skill, not the CLI. Install `cxi` as described in
[Install](#install); without it, the skill falls back to running through `npx`.

## Development

```bash
npm test          # unit tests, no network
npm run smoke     # dry-run against local auth
```

## Compatibility

Verified against codex-cli **0.149.1** and the imagegen skill stamped
**2026-08-25 08:53 KST**: auth schema, the `/responses` endpoint, the
`codex_cli_rs` originator, and the `codex exec` flags the fallback relies on
(`--ephemeral`, `--skip-git-repo-check`, `-s/--sandbox`, `-o/--output-last-message`)
are all current.

Re-check the measured behavior after **either** moves — and they move separately.
Transparency arrived with a skill update, not a CLI release, so a CLI version
match alone proves nothing. A later build may start honoring `size` for real or
lift the 1.57 MP ceiling. The quickest re-check:

```bash
cxi --prompt "a single red maple leaf icon, centered" --transparent --output /tmp/t.png
# image.hasAlpha should be true; image.width * image.height should be ~1,572,864
```

## License

MIT — see `LICENSE`.
