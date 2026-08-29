import { z } from 'zod';

/**
 * The shape the model must return for one chunk of a document.
 *
 * Previously a raw JSON Schema object living in App.tsx. It is Zod now for two
 * reasons: it validates the response at runtime on every provider, including
 * those whose schema enforcement is best-effort, and Zod 4 can emit JSON
 * Schema (`z.toJSONSchema`) for the providers that want that instead.
 *
 * Optional fields are `.nullable()` rather than `.optional()` deliberately —
 * strict structured-output modes require every property to be present, with
 * absence expressed as null. Downstream mapping already coerces with `|| ''`
 * and `!!`, so null costs nothing there.
 */
export const ExtractedEventSchema = z.object({
  summary: z.string().describe('Title of the event'),
  description: z.string().nullable().describe('Brief details about the event'),
  location: z.string().nullable().describe('Where the event takes place'),
  startDate: z.string().describe('ISO 8601 date string'),
  endDate: z.string().describe('ISO 8601 date string'),
  allDay: z.boolean().nullable(),
  ambiguousYear: z
    .boolean()
    .nullable()
    .describe('True when the event year was inferred from weak, conflicting, or fallback context'),
  yearInferenceReason: z
    .string()
    .nullable()
    .describe('Short explanation of how the event year was chosen, especially if ambiguous'),
  yearSourceText: z
    .string()
    .nullable()
    .describe('Exact nearby source text containing an explicit year, when available'),
});

export const ExtractionResultSchema = z.object({
  events: z.array(ExtractedEventSchema),
});

export type ExtractedEvent = z.infer<typeof ExtractedEventSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
