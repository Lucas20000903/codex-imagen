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

## Reference images

Pass `--image <path>` once per input image. Supported: `png`, `jpg`/`jpeg`,
`gif`, `webp`.

```bash
cxi --prompt "Make this cat wear a hat" --image ./cat.png --output ./cat-hat.png
cxi --prompt "Combine these two styles" --image ./a.png --image ./b.png --output ./combined.png
```

## Size and quality

```bash
cxi --prompt "a sunset over mountains" --size 1536x1024 --quality high --output ./sunset.png
```

- `--size`: `auto`, `1024x1024`, `2048x2048` (square); `1536x1024`, `2048x1152`,
  `3840x2160` (landscape); `1024x1536`, `2160x3840` (portrait)
- `--quality`: `auto`, `low`, `medium`, `high`

Without `--size` the model picks its own dimensions, which are often not a
listed value. Pass `--size` whenever the output has to hit exact dimensions.

## Dry run

Validates auth and prints the request without a network call.

```bash
cxi --prompt "flat blue square icon" --dry-run
```

## Required arguments

- `--prompt <text>` — always required
- `--output <path>` — output PNG path, required for live runs

## What this backend cannot do

- **No transparent backgrounds.** The image model rejects the option outright.
  Ask for a solid backdrop in the prompt and composite later if the user needs
  transparency — do not promise a transparent PNG.
- **No `input_fidelity` control.** Describe in the prompt how closely to follow a
  reference image instead.

## Prerequisites the agent must check

- `cxi` is on `PATH`.
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

## After running

`cxi` writes the PNG to `--output` and prints a JSON summary containing
`savedPath`. Report `savedPath` back to the user.
