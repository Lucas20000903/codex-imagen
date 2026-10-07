# Image model and transparent reference verification

Live calls on 2026-09-15 used the local ChatGPT session and the
`https://chatgpt.com/backend-api/codex/responses` endpoint. All six calls returned
HTTP 200 and valid PNG images. Authentication data and image payloads are not
included in this record.

## Image model reported by the server

| Run | Orchestrator | Requested image model | Reported image model |
|---|---|---|---|
| Transparent source | `gpt-5.6-sol` | omitted | `gpt-image-2-codex` |
| Color edit, explicit transparency | `gpt-5.6-sol` | `gpt-image-2.5-flare` | `gpt-image-2-codex` |
| New icon using the reference's style | `gpt-5.6-sol` | `gpt-image-2.5-flare` | `gpt-image-2-codex` |
| Second transparent source | `gpt-5.5` | `gpt-image-2.5-sunburst` | `gpt-image-2-codex` |
| Color edit, no transparency instruction | `gpt-5.6-sol` | omitted | `gpt-image-2-codex` |
| GPT-5.5 recheck, minimal prompt | `gpt-5.5` | `gpt-image-2.5-flare` | `gpt-image-2-codex` |

The outgoing `tools[0].model` was checked for each selected model. The reported
model came from the server's `response.tools[0].model` in the SSE stream; image
output items themselves did not include a model field. The default route
reported `gpt-image-2-codex`. These results do not confirm Images 2.5 execution,
even though requests naming both 2.5 models succeeded.

`cxi` now keeps `requestedImageModel` separate from `backendSettings.model` and
warns when the server reports a different model. It does not infer a model from
HTTP success, a revised prompt, or image appearance.

### GPT-5.5 recheck

A minimal run through `cxi` used top-level model
`gpt-5.5`, image tool model `gpt-image-2.5-flare`, prompt
"a tiny red circle sticker on a white background", with no reference image,
size hint, or transparency flag. The call succeeded with HTTP 200 and a
1254×1254 PNG, but the response's image tool model was still `gpt-image-2-codex`.
This confirms generation with GPT-5.5, without confirming Images
2.5 execution. The response does not explain whether its internal model name
maps to another version.

### Separate latency comparison

A subsequent six-request benchmark compared both selections with the same
prompt and `gpt-5.5`, recording full-request and image-tool timings. See
[Flare vs Sunburst latency check](flare-sunburst-benchmark-2026-09-15.md)
for all samples and original image links.

## Transparency measurements

Pillow inspected the original output bytes, without editing or removing any
background. “Fully transparent” means alpha is exactly 0. All RGBA outputs below
had an alpha range of 0–255, so transparency was confirmed from pixel values.

| Image | Format | Dimensions | Fully transparent pixels |
|---|---|---|---|
| `default-source.png` | RGBA | 1323×1189 | 82.33% |
| `flare-edit.png` | RGBA | 1323×1189 | 81.20% |
| `flare-reference.png` | RGBA | 1323×1189 | 81.43% |
| `sunburst-source.png` | RGBA | 1254×1254 | 68.68% |
| `default-edit-implicit.png` | RGB | 1323×1189 | 0% |

Every reference-based run used the same `default-source.png`, passed unchanged
as an input image. Each condition was tested once. A transparent input did not
automatically preserve transparency in the implicit edit; explicitly requesting
transparency worked in both tested reference-based prompts. Because the server
reported the same internal model for all runs, these are observations of that
route, not established Images 2.5 behavior.

## Prompts

Source (with `--transparent`):

> Generate an image of a single simple flat blue maple leaf icon, centered, nothing else. Transparent background, no shadows, no text.

Explicit edit (with `--transparent`):

> Change only the leaf color to green in the reference image. Keep the exact shape, composition, and transparent background unchanged.

Reference-based generation (with `--transparent`):

> Generate a single simple flat green maple leaf icon, centered, nothing else, in the style of the reference image. Transparent background, no shadows, no text.

Implicit edit (without `--transparent`):

> Change only the leaf color to green in the reference image. Keep its shape and composition unchanged.

`--transparent` also appends the tool's standard transparency instruction to
the prompt. Both that flag and the prompt wording changed in the implicit edit,
so this comparison does not isolate their individual effects.

## Local artifacts and automated checks

Original PNGs, request/response model metadata, and `measurements.json` are
saved locally under `.debug-codex-imagen/verification-2026-09-15/` (gitignored).

The 63-test suite covers CLI and environment precedence, SDK defaults and
overrides, retention of the model after an HTTP 401 retry, refusal to discard
model selection during fallback, extraction of the reported model from SSE and
JSON responses, and warnings on a request/response model mismatch.
