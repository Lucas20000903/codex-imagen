---
name: codex-imagen
description: >-
  Use this skill whenever the user asks to generate, create, render, draw, or
  make an image, picture, illustration, icon, logo, or any other visual asset.
  Also use it when the user wants to edit, modify, restyle, or combine existing
  images (pass them as reference inputs). The skill drives the `cxi` CLI, which
  reuses the user's local Codex ChatGPT login to reach the image-generation
  backend. Trigger phrases include "generate an image", "create a picture",
  "make an image of", "draw me a", "render this", "make this cat wear a hat",
  and similar. Prefer this skill over describing images in text.
---

# codex-imagen

Generate images from a text prompt, optionally with reference images, by running
the `cxi` CLI.

## Basic generation

```bash
cxi --prompt "flat blue square icon" --output ./out.png
```

## Image model selection

```bash
cxi --image-model gpt-image-2.5-flare --prompt "a blue leaf icon" --output ./flare.png
cxi --image-model gpt-image-2.5-sunburst --prompt "a blue leaf icon" --output ./sunburst.png
```

`--image-model` selects the requested image model. `--model` is the separate
orchestrator model. `CODEX_IMAGEN_IMAGE_MODEL` sets an image model default;
the flag overrides it. If neither is set, the server chooses.

**Verify the server's response before claiming Images 2.5 was used.** On
2026-09-15, the server reported `gpt-image-2-codex` for an unspecified image model
and for explicit `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst` requests.
Both selections were also tested with `--model gpt-5.5`, with the same reported
image model, including a minimal Flare prompt without transparency hints.
The CLI forwards the requested model, but cannot force the server to honor it.

Read `requestedImageModel` and `backendSettings.model` in the output. The latter
comes from the response, not the request; `null` means the server did not report
a model. Pass on any model mismatch warning. Model selection is supported by
`codex-http`; `codex-cli` rejects it and `auto` refuses a fallback that would
discard it.

## Reference images

Pass `--image <path>` once per input image. Supported: `png`, `jpg`/`jpeg`,
`gif`, `webp`.

```bash
cxi --prompt "Make this cat wear a hat" --image ./cat.png --output ./cat-hat.png
cxi --prompt "Combine these two styles" --image ./a.png --image ./b.png --output ./combined.png
```

## Aspect ratio and resolution

The pixel counts and limits below were measured on the default
`gpt-image-2-codex` route in August 2026. They are not verified limits for Images
2.5. This CLI still exposes aspect hints, not resolution or quality controls.

```bash
cxi --prompt "a sunset over mountains" --size 16:9 --output ./sunset.png
```

`--size` takes `WxH`, `W:H`, or `auto`. Any ratio **within 3:1** works — `16:9`,
`4:5`, `21:9`, `11:4`, `1024x1536`, whatever the user asks for. Past 3:1 the
image model cannot hold the shape, so `cxi` refuses the request instead of
returning something different in silence; tell the user to pick a ratio within
3:1 or to crop afterwards. If the delivered ratio drifts from the request, the
output carries a warning — pass that on rather than ignoring it.

**Resolution is fixed and cannot be raised.** Every image comes back at about
1.57 megapixels (exactly the area of 1536x1024), reshaped to the requested ratio:

| Asked for | Delivered |
|---|---|
| `1:1` | 1254x1254 |
| `3:2` | 1536x1024 |
| `16:9` | 1672x941 |
| `9:16` | 941x1672 |
| `21:9` | 1915x821 |

So:

- **Promise the ratio, never the pixel count.** Ratio accuracy is within 0.1%.
- **2K and 4K are not available through this tool.** If the user needs 2560x1440
  or 3840x2160, say so plainly rather than generating something smaller and
  calling it 4K. Asking for "4K" in the prompt only changes the ratio to 16:9.
  Those resolutions do exist, but only via the OpenAI Images API with the user's
  own `OPENAI_API_KEY` (billed separately) — mention that option rather than
  implying 4K is impossible everywhere.
- **There is no quality setting.** It is not exposed because it does nothing —
  neither a parameter nor prompt wording changes the resolution or the model's
  own quality pick.
- Check `image.width` / `image.height` in the output for what actually arrived.

## Output format

```bash
cxi --prompt "a bicycle" --format webp --output ./bike.webp
```

`--format` accepts `png` (default), `jpeg`, and `webp`, and it genuinely works —
this is the one backend option that is honored. Use `jpeg` when file size matters
(roughly 15x smaller than png for the same image) and `png` or `webp` when
transparency is needed. Match the `--output` extension to the format.

## Transparent background

```bash
cxi --prompt "a red maple leaf icon, centered" --transparent --output ./leaf.png
```

Transparency works and produces a real alpha channel — a capability that landed
in Codex's bundled imagegen skill on 2026-08-25. Use `--transparent` for icons,
logos, stickers, and cutouts.

**With a reference attached, the wording decides more than the flags.** On
2026-08-25, with `--transparent` and a reference image:

| Prompt shape | Transparent |
|---|---|
| "a single blue maple leaf icon, centered, nothing else, in the style of the reference" | 4 of 5 |
| "change only the leaf colour to blue; keep the shape unchanged" | 0 of 7 |

**An edit can keep transparency when it asks to.** On 2026-09-15, a transparent
blue maple leaf was supplied through `--image`, with `--transparent` and a prompt
to change only its color while preserving the transparent background. The output
was RGBA with alpha spanning 0–255 and 81.20% fully transparent pixels. The same
color edit without `--transparent` or any background instruction returned
**opaque RGB**. Creating a new green leaf in the reference's style with
`--transparent` returned RGBA with 81.43% fully transparent pixels.

Each 2026-09-15 condition was tested once, so these results are not guarantees. When a
transparent result is wanted, pass `--transparent` and explicitly ask to preserve
the transparent background. Do not assume a reference's alpha carries over.
For a new cutout based on a reference, describe a single isolated subject and use
the reference for style. If the result is opaque, rephrase toward generation and
retry once.

`image.hasAlpha` confirms an alpha channel exists; it does not prove any pixels
are transparent. Inspect the PNG's alpha values when transparency matters:
there must be some values below 255. A fully opaque RGBA image is not a cutout.

## Dry run

Validates auth and prints the request without a network call.

```bash
cxi --prompt "flat blue square icon" --dry-run
```

## Required arguments

- `--prompt <text>` — always required
- `--output <path>` — output PNG path, required for live runs

## What this backend cannot do

- **No resolution above ~1.57 MP**, and no exact pixel dimensions. See above.
- **No quality control.** The model picks it; there is no flag because a flag
  would do nothing.
- **No `input_fidelity` control.** Describe in the prompt how closely to follow a
  reference image instead.

## Prerequisites the agent must check

- `cxi` is on `PATH`. If it is not, run every command in this skill with
  `npx -y github:Lucas20000903/codex-imagen` in place of `cxi` (Node 20+; the
  arguments are the same), and tell the user they can install it permanently
  with `npm install -g github:Lucas20000903/codex-imagen`. Do not install it
  globally without asking.
- The user is signed in to Codex with ChatGPT (`~/.codex/auth.json` with
  `auth_mode = chatgpt`). If it is missing, **stop and tell the user to run
  `codex login`** — do not install Codex and do not fabricate auth state.

## Handling failures

`cxi` prints `CODE: message` on failure. React to the code, not the text:

- `IMAGE_GENERATION_DECLINED` — the safety filter declined the prompt. **Do not
  retry the same prompt; it will fail identically.** Rewrite it once and try
  again. For classical or fine-art subjects, saying figures are clothed
  ("modestly draped in flowing robes, fully clothed, no nudity") usually passes
  while keeping the composition. If a rewrite is also declined, stop and tell
  the user rather than looping.
- `MISSING_IMAGE_GENERATION_OUTPUT` — transport problem, retrying is reasonable.
- `UNAUTHORIZED` / `MISSING_CODEX_AUTH` — tell the user to run `codex login`.
- `RATE_LIMITED` — report it; do not hammer the backend.

`cxi` already retries transient failures (empty streams, 5xx, 429, transport)
twice on its own, and refreshes the Codex token when it is about to expire. So a
failure that reaches you has already survived retries — do not loop on it
yourself. Report it instead.

## After running

`cxi` writes the PNG to `--output` and prints a JSON summary containing
`savedPath`. Report `savedPath` back to the user.
