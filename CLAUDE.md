# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev        # Vite dev server on port 3000 (strictPort — fails if taken)
npm run build      # static bundle into dist/
npm run preview

npm run lint       # tsc --noEmit && stylelint --fix && check:css-vars && check:css-classes
npm run lint:types # tsc --noEmit alone
npm run lint:css   # stylelint on src/**/*.css (auto-fixes)
npm run check:css-vars    # fails on var(--x) with no matching --x: declaration in src/**/*.css
npm run check:css-classes # fails on class selectors starting with a digit

npm run test:long-document-fixture  # asserts fixtures/long-document-event-after-15000.txt
                                    # still has its event past char 15,000
```

There is no test runner. `test:long-document-fixture` is a guard script, not a test suite — it only verifies the fixture that exists to prove long documents aren't truncated. `npm run lint` is the closest thing to a full check; run it before pushing (CI does not run it — `.github/workflows/deploy.yml` only builds and publishes to GitHub Pages on `main`).

TypeScript is configured with `strict: false` and most safety flags off, so `tsc --noEmit` catches far less than usual.

## Architecture

Single-page React 19 + Vite app. No router, no backend, no persistence — state lives in `App.tsx` and is lost on reload. `@/` aliases `src/`.

**The whole extraction pipeline lives in `src/App.tsx`** (top-level helpers above the component). Only three small modules sit under `src/lib/`:

- `lib/ics.ts` — `CalendarEvent` type plus `parseICS`/`generateCleanICS` over `ical.js`. Single source of truth for the event shape.
- `lib/events.ts` — validation. Warnings are plain strings prefixed with `EVENT_VALIDATION_WARNING_PREFIX`; that prefix is how `mergeEventValidationWarnings` tells its own warnings apart from AI-supplied year warnings and replaces only its own on re-validation. `hasBlockingValidationWarnings` gates export.
- `lib/blink.ts` — Blink SDK client (`authRequired: false`).

### Two input paths

`.ics` uploads are parsed locally by `parseICS` — no AI call. Everything else (`.pdf`, `.txt`, `.eml`, `.msg`, `.docx`; extension allowlist in `UploadZone.tsx`) goes through the AI flow.

### AI extraction flow (`handleFileLoaded`)

1. `blink.data.extractFromBlob(file)` — deliberately blob-based, not a storage upload, to avoid creating public URLs that leak filenames.
2. `splitTextIntoExtractionChunks` — 12,000-char chunks that back off to a natural break (`\n\n`, `\n`, `. `, `; `) no earlier than 65% into the chunk; capped at 25 chunks. Leftover text is reported as `omittedCharacters` and surfaced as a "partial extraction" banner. This chunking replaced an old hard 15,000-char cutoff — the fixture and guard script exist to keep that regression from returning.
3. One `blink.ai.generateObject` call per chunk against `EVENT_SCHEMA`, with a prompt that carries the chunk index and the resolved default year.
4. Per-event validation: events failing `validateEventFields` are dropped and reported in a toast; survivors are mapped and re-validated.
5. `dedupeEvents` merges chunk results on normalized `summary|startDate|endDate|location`.

### Year inference

`buildDefaultYearPlan` resolves the fallback year in strict precedence: user-selected dropdown → years found in the document text → years found in the filename → date-based fallback (`getDateBasedFallbackYear` rolls to next year from October onward). When more than one year is found, or the date-based fallback is used, the plan is marked `isAmbiguous` and every event resting on that year gets a review warning. The AI schema also returns `ambiguousYear` / `yearInferenceReason` / `yearSourceText`, folded in by `getYearValidationWarnings`. Changes here should keep both the plan description shown in the UI and the prompt text in sync — `describeDefaultYearPlan` feeds both.

## UI conventions

`src/components/ui/` is generated shadcn/ui (new-york style, `components.json`, `tailwind.config.cjs`) — treat it as vendored; edit app code in `App.tsx`, `UploadZone.tsx`, `EventList.tsx` instead. Toasts are `sonner`, animation is `framer-motion`, icons are `lucide-react`.

`src/index.css` still carries the Blink template's placeholder-palette comments telling an agent to replace the colors; the palette has since been customized, so ignore that instruction unless asked to restyle.

## Environment

`VITE_BLINK_PROJECT_ID` and `VITE_BLINK_PUBLISHABLE_KEY`. Both `lib/blink.ts` and `main.tsx` independently duplicate a `getProjectId()` that falls back to the `*.sites.blink.new` hostname and then to a hardcoded project id — change both together. `.env.local` is committed with publishable (client-side) values.

`index.html` loads `https://blink.new/auto-engineer.js` behind a comment marked do-not-remove; leave it alone.

## Dead code

`src/main.ts`, `src/counter.ts`, `src/style.css`, `src/App.css`, and `src/typescript.svg` are leftovers from the Vite vanilla-TS template. The real entry is `src/main.tsx` → `src/App.tsx`, and the only stylesheet in use is `src/index.css`.
