# Flare vs Sunburst latency check — 2026-09-15

Six sequential live requests used `cxi`'s HTTP provider and the same local ChatGPT session. Only the requested image model changed. All requests used `gpt-5.5`, PNG output, a 1:1 aspect hint, the same prompt, and no reference image or transparency flag. The recorded request bodies were compared after removing the image model field and were identical.

Order: Flare → Sunburst → Sunburst → Flare → Flare → Sunburst. No requests ran concurrently, failed, or were retried. No warm-up samples were excluded. All six PNG hashes differ.

## Summary

| Requested model | n | Mean total | Median total | Range | Mean image-tool interval |
|---|---:|---:|---:|---:|---:|
| Flare | 3 | 30.03s | 27.70s | 27.50–34.89s | 27.47s |
| Sunburst | 3 | 27.86s | 27.97s | 25.43–30.20s | 26.29s |

## Individual runs

| Run | Requested model | Total | Image-tool interval | Server quality | Dimensions |
|---:|---|---:|---:|---|---|
| 1 | Flare | 27.700s | 25.015s | low | 1254×1254 |
| 2 | Sunburst | 25.428s | 24.079s | low | 1254×1254 |
| 3 | Sunburst | 30.200s | 28.353s | medium | 1254×1254 |
| 4 | Flare | 34.893s | 31.204s | medium | 1254×1254 |
| 5 | Flare | 27.504s | 26.186s | low | 1254×1254 |
| 6 | Sunburst | 27.966s | 26.435s | low | 1254×1254 |

## Interpretation

In this small sample, Sunburst requests had 7.2% shorter mean total time. Median times were almost identical: 27.70s for Flare and 27.97s for Sunburst. The observed ranges overlap, and three samples per selection do not establish a stable speed advantage. Each selection produced two `low`-quality responses and one `medium`-quality response. The server chose quality automatically; this is not a benchmark with quality fixed by the client.

Every response reported `gpt-image-2-codex` as its image tool model, despite the outgoing `gpt-image-2.5-flare` or `gpt-image-2.5-sunburst` selection. These timings therefore describe these requests through the private Codex endpoint. They do not establish which underlying model executed, nor demonstrate that the two selections route to different models.

For public API model positioning, official OpenAI documentation describes [Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare) as optimized for fast everyday generation and [Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst) as focused on capable generation and precise edits. Those descriptions do not establish how this private Codex route maps its internal model name.

## Timing definition

- Total: monotonic wall-clock time from entering `generateImage()` through parsing and writing the PNG. Includes local session loading, network time, orchestration, image generation, and file output.
- Image-tool interval: receipt of the first image tool start event through receipt of `response.output_item.done` with the final image. It includes tool-side waiting and final image transfer; it is not an isolated GPU compute measurement.

## Prompt

> Create a square studio product illustration of a transparent glass teapot filled with amber tea, beside one small white ceramic cup and three green tea leaves on a warm cream surface. Show fine etched leaf patterns on the glass, realistic reflections, and soft shadows. At the top, print exactly 'MOONLEAF TEA' in clean, legible dark-green lettering. At the bottom, print exactly 'Small leaves. Slow moments.' Keep the whole scene in frame. Opaque background.

The 1:1 hint adds the tool's standard square-composition instruction to this prompt.

## Artifacts

Original PNGs, `benchmark.json` (including request fields and stream event timing), `summary.json`, and the measurement script are in `.debug-codex-imagen/flare-sunburst-benchmark-2026-09-15/` (local, gitignored). The raw image bytes were not edited.

- [Flare sample at its median total time](../.debug-codex-imagen/flare-sunburst-benchmark-2026-09-15/01-flare.png)
- [Sunburst sample at its median total time](../.debug-codex-imagen/flare-sunburst-benchmark-2026-09-15/06-sunburst.png)
