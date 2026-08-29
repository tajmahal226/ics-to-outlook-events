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

### Document text extraction moves into the browser

Replacing `extractFromBlob` with client-side parsing. This is a privacy
improvement, not just a removal: files stop leaving the device entirely, which
is what the existing comment in `handleFileLoaded` was already reaching for.

| Format | Library |
|---|---|
| `.pdf` | `pdfjs-dist` |
| `.docx` | `mammoth` |
| `.eml` | `postal-mime` |
| `.txt` | `File.text()` — no library |
| `.ics` | `ical.js`, already local |
| `.msg` | **spike required — see risks** |

New module `src/lib/extractText.ts` owns the format → text mapping, so
`App.tsx` calls one function regardless of type.

### Settings

A dialog opened from the nav, beside "How it works" — the app has no router and
this matches the pattern already present. Fields: provider, model, API key,
and a **Test connection** button that makes one cheap call so a bad key is
found before it costs an upload.

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
src/lib/extractText.ts            file → text, client-side
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

**Modified:** `App.tsx` (three call sites plus the no-key gate), `index.html`
(title is still "Blink App"), `README.md`, `CLAUDE.md`.

---

## Risks

1. **`.msg` is the one format that may not survive.** Outlook `.msg` is a
   compound binary format and Blink's server-side extractor probably handles it
   better than anything runnable in a browser. Time-box a spike on
   `@kenjiuno/msgreader` early. If it does not hold up, drop `.msg` from the
   allowlist rather than ship a format that silently produces nothing — the
   honest failure is refusing the file.
2. **The API key sits in `localStorage`,** readable by any script on the page.
   Mitigated by: it is the user's own key, the app becomes a static bundle with
   one less third-party script (`auto-engineer.js` goes), and the settings
   dialog should recommend a dedicated key with a spend limit. This is a real
   trade, accepted deliberately, and it is why no-backend was chosen over a
   serverless proxy.
3. **Cost moves to the user.** Roughly $0.25–0.30 per ~60k-character agenda at
   Claude Opus 5 rates; materially less at lower effort or on a cheaper model.
   The settings dialog should not hide which model is selected.
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

Still genuinely unknown, and only answerable by running it:

- whether `@kenjiuno/msgreader` handles real `.msg` files well enough to keep
  the format (risk 1)
- real-world extraction quality per provider on an actual agenda, which is a
  judgement call rather than a fact to look up

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
- Confirm no `blink` string remains outside `package-lock.json`.

## Sequencing

1. Provider seam + Anthropic adapter + settings dialog + key storage.
2. Client-side `extractText.ts` (spike `.msg` first — it may cut scope).
3. OpenAI-shape adapter, then OpenRouter and x.ai as presets over it.
4. Gemini adapter.
5. Remove Blink; update README, CLAUDE.md, `index.html` title.

Steps 1 and 2 are independently useful: after them the app runs on one provider
with no Blink in the AI path.
