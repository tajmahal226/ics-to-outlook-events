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

**Defaults are the cheap tier, not the flagship.** Verified pricing per million
tokens, all vision-capable:

| Provider | Default model | In / Out |
|---|---|---|
| OpenAI | `gpt-5-nano` | $0.05 / $0.40 |
| Google Gemini | `gemini-2.5-flash-lite` | $0.10 / $0.40 |
| OpenRouter | `google/gemini-2.5-flash-lite` | $0.10 / $0.40 |
| Anthropic | `claude-haiku-4-5` | $1.00 / $5.00 |
| x.ai | `grok-4.3` | $1.25 / $2.50 |

At these rates a ~60k-character agenda costs well under a cent on the OpenAI
and Gemini defaults, against roughly $0.25–0.30 on a flagship. The dialog shows
the selected model plainly so nobody is surprised by either the cost or the
quality; upgrading is one dropdown away.

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

6. **Cheap models may extract less well.** The defaults above are chosen on
   price, and the product's whole value is the quality of the extraction. This
   is worth measuring on a real agenda before settling: if a nano-tier model
   misses sessions a flagship catches, the right default is the one that gets
   the schedule right, not the one that costs least. Treat the table as a
   starting point to be validated, not a conclusion.
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

Still genuinely unknown, and only answerable by running it:

- whether `utif` → canvas → PNG handles real multi-page TIFFs (risk 1)
- whether the empty-text heuristic reliably distinguishes a scanned PDF from a
  sparse one
- real-world extraction quality per provider and per tier on an actual agenda,
  which is a judgement call rather than a fact to look up (risk 6)

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
   rasterise fallback. **Spike `.tiff` at the start of this step** — it may cut
   scope, and finding that out before the rest is built is cheaper.
4. OpenAI-shape adapter, then OpenRouter and x.ai as presets over it.
5. Gemini adapter.
6. Remove Blink; update README, CLAUDE.md, `index.html` title.

Steps 1 and 2 are independently useful and shippable: after them the app runs
on one provider, with no Blink, over every text format. Step 3 is where the
new capability lands.
