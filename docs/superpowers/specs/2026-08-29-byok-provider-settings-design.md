# Bring-your-own-key provider settings — design

**Date:** 2026-08-29
**Status:** awaiting review
**Goal:** remove the Blink dependency entirely and let each person choose an AI
provider and supply their own API key through a settings dialog.

---

## Why

Today every AI call goes through Blink. `.env` ships Blink's publishable key,
`index.html` loads `blink.new/auto-engineer.js` (which paints a "Made with
Blink" badge on the page), and `lib/blink.ts` and `main.tsx` each carry a
hardcoded project id. The app cannot be run or deployed by anyone else without
inheriting that account.

Blink is doing three jobs:

| Call | Job |
|---|---|
| `blink.data.extractFromBlob(file)` | PDF/DOCX/EML/MSG → plain text |
| `blink.ai.generateObject({prompt, schema})` | text chunk → structured events |
| `blink.ai.generateText({prompt})` | tidy up one event description |

Only the middle one is load-bearing for the product. All three need replacing.

## Non-goals

- No backend, no serverless function. The app stays a static bundle on Vercel.
- Not changing the extraction pipeline's shape: chunking, dedupe, year
  inference, and the two-tier validation model all stay exactly as they are.
- Not adding provider-side model discovery. Model lists are curated constants.

---

## Architecture

### The seam

One narrow interface, so `App.tsx` never learns which provider is in use:

```ts
// src/lib/providers/types.ts
export interface AiProvider {
  extractEvents(prompt: string, schema: object): Promise<unknown>;
  polishText(prompt: string): Promise<string>;
  testConnection(): Promise<void>;
}
```

`App.tsx` swaps `blink.ai.generateObject(...)` → `provider.extractEvents(...)`
and `blink.ai.generateText(...)` → `provider.polishText(...)`. Nothing else in
the pipeline moves.

### Five providers, three adapters

OpenRouter and x.ai both speak the OpenAI request shape, so they are preset
base URLs on the OpenAI adapter rather than new code.

| Provider (UI) | Adapter | Base URL |
|---|---|---|
| Anthropic | `anthropic.ts` | SDK default |
| OpenAI | `openaiCompatible.ts` | `https://api.openai.com/v1` |
| OpenRouter | `openaiCompatible.ts` | `https://openrouter.ai/api/v1` |
| x.ai (Grok) | `openaiCompatible.ts` | `https://api.x.ai/v1` |
| Google Gemini | `gemini.ts` | SDK default |

Each browser SDK requires an explicit opt-in to run client-side —
`dangerouslyAllowBrowser: true` on Anthropic and OpenAI. This is verified for
both. Gemini's SDK initialises identically in a browser and its docs warn
against it rather than gating it.

### Structured output is the hard part

`generateObject` currently guarantees the response matches `EVENT_SCHEMA`.
Each provider spells that differently, and this is where the work concentrates:

- **Anthropic** — `output_config.format`, or `messages.parse()`.
- **OpenAI-shape** — `response_format: {type: "json_schema", ...}` with
  `strict: true`. Confirmed on OpenAI and on x.ai (`response_format.type =
  "json_schema"`). **OpenRouter is the exception worth designing for:** strict
  mode support depends on *which provider is currently serving the chosen
  model*, not on the model itself, so the same model id can support it on one
  routing and not another. Treat OpenRouter as never guaranteed and always run
  the validating fallback path.
- **Gemini** — a `response_format` object carrying `type`, `mime_type:
  "application/json"`, and `schema`. Gemini accepts a *subset* of JSON Schema;
  `EVENT_SCHEMA` uses only supported keywords (`object`, `properties`,
  `required`, `array`/`items`, `string`, `boolean`, `description`), so it maps
  across as-is. Deeply nested or very large schemas can be rejected — not a
  concern at this schema's size.

Adapters normalise this behind `extractEvents`. Where a provider cannot
guarantee schema conformance, the adapter falls back to instructing JSON in the
prompt and validating the parsed result. **Validation is not optional in either
path** — a malformed response must surface as a clear error, never as silently
dropped events. `validateEventFields` already drops bad events downstream; the
adapter's job is to fail loudly when the response isn't the right *shape*.

### Input handling: two paths, not one

Replacing `extractFromBlob` with client-side parsing. This is a privacy
improvement, not just a removal: files stop leaving the device for parsing,
which is what the existing comment in `handleFileLoaded` was already reaching
for.

Adding image formats splits the pipeline in two. A `.png` of an agenda cannot
be parsed to text in the browser — it goes to the model **as an image**, over
the vision path. Every provider's cheap tier supports vision (verified below),
so this costs nothing in model choice, but it is a genuinely different branch.

| Format | Path | How |
|---|---|---|
| `.txt`, `.md` | text | `File.text()` — no library |
| `.pdf` | text, **falling back to vision** | `pdfjs-dist` |
| `.docx` | text | `mammoth` |
| `.ics` | local parse, no model at all | `ical.js`, already present |
| `.eml` | text | `postal-mime` |
| `.jpg`, `.jpeg`, `.png` | vision | passed through as base64 |
| `.tiff` | vision, **after conversion** | `utif` → canvas → PNG (see risks) |

**Scanned PDFs are why the fallback exists.** `pdfjs-dist` returns little or no
text for a PDF that is a scan, and conference agendas are often scans. Rather
than silently extracting nothing, when a PDF yields implausibly little text the
pipeline renders its pages to canvas and sends them down the vision path.
`pdfjs-dist` already rasterises pages, so this reuses machinery that has to be
there anyway. Without it, "PDF is supported" would be false for a large share
of real agendas.

Two modules rather than one:

- `src/lib/extractText.ts` — file → text, for the text formats.
- `src/lib/extractImages.ts` — file → `{mediaType, base64}[]`, for the image
  formats and for rasterised PDF pages.

`App.tsx` asks for one or the other based on the file, and the provider
interface gains an image-bearing call.

**Consequences for the existing pipeline, which must be handled explicitly:**

- **Year inference has no source text on the vision path.**
  `buildDefaultYearPlan` reads `sourceText` first; for an image that is empty,
  so resolution falls to filename, then the date-based fallback, and the plan
  is marked ambiguous. Every event then carries a review warning. That is the
  correct behaviour and it should be deliberate, not incidental.
- **Chunking does not apply to images.** `splitTextIntoExtractionChunks` is a
  text operation. Multi-page documents chunk by *page* on the vision path, with
  the same per-chunk prompt carrying its index.
- **The source-text view will be empty** for image inputs. The "Source text"
  tab should say so rather than render a blank pane.

### OCR quality is a resolution problem before it is a model problem

The cheap-tier defaults were chosen on price. Checked against each provider's
vision documentation, **one of them would have quietly ruined the OCR path**,
and the reason generalises: every provider degrades small text, and each one
gives a different lever to stop it.

| Provider | What it does to a large image | The lever |
|---|---|---|
| **Anthropic** | **Downscales** to the model's tier cap: 1568 px long edge on standard, 2576 px on Claude 4.7 and later | Must use a 4.7-or-later model. There is no parameter that rescues a standard-tier model. |
| **Gemini** | **Tiles** into 768×768 blocks at 258 tokens each — resolution is preserved, not discarded | `media_resolution`; higher "improve[s] the model's ability to read fine text" |
| **OpenAI** | Patch-based, capped by a patch budget per `detail` level | `detail: "original"` — "fits within 65,535 × 65,535 pixels, with no patch-budget limit", and the docs explicitly recommend it for text-heavy images |

**`claude-haiku-4-5` is standard tier.** A 300 DPI A4 scan is roughly
2480×3508 px; downscaled to a 1568 px long edge it becomes ~1108×1568, about
130 DPI. Anthropic's own guidance says this plainly — resizing "might, for
example, make text less legible" — and names *dense documents* as the case that
needs the high-resolution tier. Haiku would have been the wrong default for
precisely the input this feature exists to handle.

Three consequences:

**1. Two model settings, not one.** The text path is only *structuring* text
that has already been extracted losslessly; the cheap tier is genuinely fine
there. The vision path must *read pixels*. They are different jobs and get
different defaults:

| Provider | Text path | Vision / OCR path |
|---|---|---|
| Gemini | `gemini-2.5-flash-lite` ($0.10/$0.40) | `gemini-2.5-flash` ($0.30/$2.50), `media_resolution` high |
| OpenAI | `gpt-5-nano` ($0.05/$0.40) | `gpt-5-mini` ($0.25/$2.00), `detail: "original"` |
| Anthropic | `claude-haiku-4-5` ($1/$5) | `claude-sonnet-5` ($2/$10) — cheapest high-resolution tier |
| x.ai | `grok-4.3` ($1.25/$2.50) | `grok-4.3` — image handling unverified, see below |

Settings shows both, defaulted, with the vision one labelled as the one that
reads scans and photos.

**2. Each adapter must set its provider's OCR flag.** `detail: "original"` and
`media_resolution` are not optional tuning — omitting them silently reverts to
the degraded path. This belongs in the adapter, not in user-facing settings.

**3. Rasterisation DPI and tiling are ours to control, and are the strongest
lever.** Because we render PDF pages ourselves via `pdfjs-dist`, we choose the
output resolution. Rendering a page and letting a provider downscale it wastes
the fidelity we just produced. Instead: render at high DPI, then split into
tiles sized to stay under the provider's threshold, so full resolution reaches
the model.

The tradeoff is real and must be handled: tiling destroys layout context, and
on a schedule the layout *is* information — which time column a session sits
in, which room heading governs which block. Anthropic's guidance warns against
"cropping out key visual context solely to enlarge the text". So tiles overlap,
and each page is also sent whole at lower resolution to carry structure. More
images also means more tokens, and above 20 images per request Anthropic
applies a stricter 2000 px per-image cap — so tile counts stay bounded.

Cost stays modest even so: Gemini's tiling puts a 10-page agenda near 15k input
tokens, well under a cent at flash rates; Anthropic's high-resolution tier runs
about 4,784 visual tokens per full page, so the same document is roughly
$0.10–0.15 on Sonnet 5. The OCR path costs more than the text path, and it
should — it is doing more.

### Interface, revised for images

```ts
export interface AiProvider {
  extractEvents(prompt: string, schema: object, images?: ImagePart[]): Promise<unknown>;
  polishText(prompt: string): Promise<string>;
  testConnection(): Promise<void>;
}

type ImagePart = { mediaType: 'image/png' | 'image/jpeg'; base64: string };
```

### Settings

A dialog opened from the nav, beside "How it works" — the app has no router and
this matches the pattern already present. Fields: provider, model, API key,
and a **Test connection** button that makes one cheap call so a bad key is
found before it costs an upload.

**Two model settings, cheap by default but not uniformly** — see *OCR quality
is a resolution problem* below for why the vision path cannot use the cheapest
tier. Verified pricing per million tokens; all listed models are
vision-capable, but not all read fine text well.

| Provider | Text path | Vision / OCR path |
|---|---|---|
| OpenAI | `gpt-5-nano` ($0.05/$0.40) | `gpt-5-mini` ($0.25/$2.00) |
| Google Gemini | `gemini-2.5-flash-lite` ($0.10/$0.40) | `gemini-2.5-flash` ($0.30/$2.50) |
| OpenRouter | `google/gemini-2.5-flash-lite` | `google/gemini-2.5-flash` |
| Anthropic | `claude-haiku-4-5` ($1/$5) | `claude-sonnet-5` ($2/$10) |
| x.ai | `grok-4.3` ($1.25/$2.50) | `grok-4.3` |

On the text path a ~60k-character agenda costs well under a cent on the OpenAI
and Gemini defaults, against roughly $0.25–0.30 on a flagship. The OCR path
costs more and should. The dialog shows both selections plainly so nobody is
surprised by either cost or quality; upgrading is one dropdown away.

**Model lists are fetched live, not hardcoded.** Every provider exposes a models
endpoint (`/v1/models` on Anthropic, OpenAI, and x.ai; `/api/v1/models` on
OpenRouter, which needs no key; `models.list` on Gemini). The dropdown populates
from the user's own key after it is entered, with the table above as the
pre-flight default. This keeps the app from going stale as model names change —
the constants above are a starting point, not a maintained list.

Config shape, persisted to `localStorage` under one key:

```ts
type ProviderSettings = {
  providerId: 'anthropic' | 'openai' | 'openrouter' | 'xai' | 'gemini';
  model: string;
  apiKey: string;
};
```

`src/lib/settings.ts` owns load/save with a try/catch — `localStorage` throws
in some privacy modes, and the app must still render.

### Degradation with no key

`.ics` parses locally and needs no provider, so a first-run user is not
staring at a dead app. The AI paths gate instead:

- No key set → the upload zone still accepts `.ics`; other formats prompt to
  open Settings rather than failing at the API call.
- The empty-state rail gains one line pointing at Settings.

---

## Files

**Added**
```
src/lib/providers/types.ts        interface + settings type
src/lib/providers/registry.ts     per-provider metadata, default models
src/lib/providers/anthropic.ts
src/lib/providers/openaiCompatible.ts   OpenAI, OpenRouter, x.ai
src/lib/providers/gemini.ts
src/lib/providers/index.ts        factory: settings → AiProvider
src/lib/settings.ts               localStorage load/save
src/lib/extractText.ts            file → text (txt, md, pdf, docx, eml)
src/lib/extractImages.ts          file → base64 images (jpg, png, tiff, PDF pages)
src/components/SettingsDialog.tsx
```

**Removed**
```
src/lib/blink.ts
BlinkProvider / BlinkAuthProvider wrapper in main.tsx
the getProjectId() duplicated in main.tsx
auto-engineer.js script tag in index.html   (takes the "Made with Blink" badge)
@blinkdotnew/react, @blinkdotnew/sdk        from package.json
VITE_BLINK_* from .env, README, CLAUDE.md
```

**Modified:** `App.tsx` (three call sites, the no-key gate, and the text/vision
branch), `UploadZone.tsx` (`ACCEPTED_EXTENSIONS` becomes `.pdf .txt .md .jpg
.jpeg .png .tiff .docx .ics .eml`, and the displayed list grows past one row),
`EventList.tsx` (the Source text tab must say so when the input was an image),
`index.html` (title is still "Blink App"), `README.md`, `CLAUDE.md`.

Because `UploadZone` now derives its `accept` attribute from that one array,
the list only changes in a single place.

---

## Risks

1. **`.tiff` cannot be sent to any provider as-is, and browsers cannot decode
   it.** No vision API accepts TIFF — Anthropic takes JPEG/PNG/GIF/WebP, OpenAI
   the same set, Gemini PNG/JPEG/WebP/HEIC/HEIF — and Chrome and Firefox will
   not render TIFF in an `<img>` either, so the usual canvas trick does not
   work unaided. It requires a JavaScript decoder (`utif`) to produce pixel
   data, then a canvas re-encode to PNG before upload. Multi-page TIFFs, which
   are common for scans, become multiple images. This is buildable but it is
   the riskiest item here; spike it early, and if it does not hold up, reject
   `.tiff` with a message telling the user to save as PNG rather than accept a
   file that silently yields nothing.

   *Superseded:* `.msg` was the previous holder of this risk. It is dropped —
   see the format table.
2. **The API key sits in `localStorage`,** readable by any script on the page.
   Mitigated by: it is the user's own key, the app becomes a static bundle with
   one less third-party script (`auto-engineer.js` goes), and the settings
   dialog should recommend a dedicated key with a spend limit. This is a real
   trade, accepted deliberately, and it is why no-backend was chosen over a
   serverless proxy.
3. **Cost moves to the user**, though the cheap-tier defaults make it small —
   well under a cent per agenda on `gpt-5-nano` or `gemini-2.5-flash-lite`,
   against roughly $0.25–0.30 on a flagship. Images cost more than text for the
   same document, since a rasterised page is worth more tokens than its text.
   The settings dialog should not hide which model is selected.

6. **Cheap models may extract less well, and OCR is where it bites.** The
   resolution analysis below sets defaults that should be adequate, but
   adequate is a prediction, not a measurement. The product's whole value is
   extraction quality. Before these defaults are called settled, run a real
   scanned agenda through each provider's vision default and compare against a
   flagship on the same input: if the cheaper model drops sessions, misreads
   times, or transposes columns, the right default is the one that gets the
   schedule right. This is the single most important thing to measure, and it
   cannot be resolved from documentation — only by running it.

7. **x.ai's image handling is unverified.** Anthropic, Gemini, and OpenAI all
   document their resolution behaviour and their OCR levers; x.ai's docs cover
   structured outputs but not image preprocessing. Grok may downscale, tile, or
   cap in ways that hurt dense scans, with no known parameter to opt out.
   Until that is established, treat x.ai as supported for the text path and
   unproven for OCR, and say so in the settings dialog rather than letting
   someone discover it on a scan.
4. **`pdfjs-dist` ships a worker** and needs its worker URL wired for Vite.
   Routine, but it is the usual place a PDF integration breaks in a bundler.
5. **Bundle size.** Four parser libraries plus three SDKs land in a bundle
   already warning at 667 kB. Adapters and parsers should be dynamically
   imported so only the chosen provider and the formats actually used load.

## Verified

Checked against primary docs and by live request on 2026-08-29.

**CORS — every endpoint permits direct browser calls.** Measured with an
`OPTIONS` preflight carrying `Origin`, `Access-Control-Request-Method: POST`,
and the auth headers each SDK sends:

| Endpoint | Result |
|---|---|
| `api.anthropic.com/v1/messages` | `allow-origin: *`; allow-headers names `anthropic-dangerous-direct-browser-access` |
| `api.openai.com/v1/chat/completions` | reflects origin; `authorization, content-type` |
| `openrouter.ai/api/v1/chat/completions` | `allow-origin: *`; allow-headers includes the `X-Stainless-*` set the OpenAI SDK emits, so the SDK works against it unmodified |
| `api.x.ai/v1/chat/completions` | `allow-origin: *`; methods and headers both `*` |
| `generativelanguage.googleapis.com` | reflects origin; allows `x-goog-api-key` |

This removes the last structural doubt: no proxy is needed for any of the five.

**Base URLs:** `https://api.x.ai/v1` and `https://openrouter.ai/api/v1`, both
confirmed from their own documentation.

**Structured output:** confirmed per provider in the section above. The single
substantive caveat is OpenRouter's routing-dependent strict mode.

**Models and pricing**, read from OpenRouter's public catalogue on 2026-08-29.
Every default in the settings table is vision-capable, which is what makes the
image formats viable on the cheap tier. Native provider ids differ from
OpenRouter's prefixed ids (`claude-haiku-4-5` natively vs
`anthropic/claude-haiku-4.5` through OpenRouter); the adapters own that mapping,
and the live model fetch makes a wrong default self-correcting.

**Image resolution behaviour**, read from each provider's vision docs on
2026-08-29 and summarised in *OCR quality is a resolution problem*: Anthropic
downscales to 1568 px (standard) or 2576 px (Claude 4.7+); Gemini tiles at
768×768 and exposes `media_resolution`; OpenAI is patch-based with a `detail`
parameter whose `"original"` setting removes the patch budget and is explicitly
recommended for text-heavy images. This is what disqualified `claude-haiku-4-5`
as the OCR default.

Still genuinely unknown, and only answerable by running it:

- whether `utif` → canvas → PNG handles real multi-page TIFFs (risk 1)
- whether the empty-text heuristic reliably distinguishes a scanned PDF from a
  sparse one
- **real extraction accuracy per provider on a real scanned agenda** — the
  defaults above are reasoned from resolution limits, which is a much better
  basis than price alone, but it is still reasoning rather than measurement
  (risk 6)
- x.ai's image preprocessing, undocumented as far as could be found (risk 7)
- the tile size and overlap that preserve schedule layout while keeping text
  legible; this needs tuning against a real agenda, not choosing up front

## Verification

- `npm run lint` and `npm run build` clean.
- `npm run test:long-document-fixture` still passes — the chunking path is
  untouched and must stay that way.
- Drop an `.ics` with **no key configured** and confirm events still render.
  This is the keyless path and the one most likely to regress.
- Per provider: Test connection succeeds with a good key, fails clearly with a
  bad one.
- One real agenda through at least one provider, end to end, checking that the
  amber/oxide warning tiers still populate.
- **A photographed or screenshotted agenda** through the vision path, checking
  that year inference correctly reports itself as ambiguous when there is no
  source text to read a year from.
- **A scanned PDF** (no text layer), confirming it rasterises and routes to
  vision rather than returning zero events.
- Each accepted extension actually accepted, and an unsupported one refused
  with a message that names what to do instead.
- Confirm no `blink` string remains outside `package-lock.json`.

## Sequencing

1. Provider seam + Anthropic adapter + settings dialog + key storage.
2. `extractText.ts` for the text formats (`.txt`, `.md`, `.pdf`, `.docx`,
   `.eml`). At this point Blink is out of the AI path entirely.
3. `extractImages.ts` and the vision branch: images first, then the scanned-PDF
   rasterise fallback, then tiling. **Spike `.tiff` at the start of this step**
   — it may cut scope, and finding that out before the rest is built is
   cheaper. **End this step by running one real scanned agenda through the
   vision default and a flagship side by side** (risk 6). Tile size, overlap,
   and rasterisation DPI get tuned against that result rather than guessed;
   if the cheap default drops sessions, the default changes here, before the
   remaining adapters are written against it.
4. OpenAI-shape adapter, then OpenRouter and x.ai as presets over it.
5. Gemini adapter.
6. Remove Blink; update README, CLAUDE.md, `index.html` title.

Steps 1 and 2 are independently useful and shippable: after them the app runs
on one provider, with no Blink, over every text format. Step 3 is where the
new capability lands.
