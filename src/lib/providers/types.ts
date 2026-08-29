import { z } from 'zod';

/**
 * The seam between the extraction pipeline and whichever AI provider the user
 * has configured. `App.tsx` talks to this interface and never learns which
 * provider is behind it.
 */

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'xai' | 'gemini';

/** An image ready to hand to a vision model. Used by the vision path (step 3). */
export interface ImagePart {
  mediaType: 'image/png' | 'image/jpeg';
  base64: string;
}

export interface ProviderSettings {
  providerId: ProviderId;
  apiKey: string;
  /** Structures already-extracted text. Cheap tier is fine here. */
  textModel: string;
  /**
   * Reads pixels on the vision path. Deliberately separate from textModel:
   * the cheapest tier is often the wrong choice for OCR, because providers
   * downscale large images and a scanned agenda loses its small text. See the
   * OCR section of the design spec.
   */
  visionModel: string;
}

export interface AiProvider {
  /**
   * Returns a value parsed and validated against `schema`. Implementations
   * MUST throw when the response does not match — never return a partial or
   * empty result, because the caller cannot otherwise distinguish "no events
   * in this chunk" from "the model returned something unusable".
   *
   * The schema is a Zod type rather than raw JSON Schema so that validation is
   * guaranteed on every provider, including those whose schema enforcement is
   * advisory (OpenRouter's depends on which upstream serves the model).
   */
  extractEvents<T>(prompt: string, schema: z.ZodType<T>, images?: ImagePart[]): Promise<T>;
  polishText(prompt: string): Promise<string>;
  /** One cheap call, so a bad key is found before it costs an upload. */
  testConnection(): Promise<void>;
}

/** Thrown when a provider is selected but no key has been entered yet. */
export class MissingApiKeyError extends Error {
  constructor() {
    super('No API key configured. Open Settings to add one.');
    this.name = 'MissingApiKeyError';
  }
}

/** Thrown when a response cannot be read as the requested schema. */
export class MalformedResponseError extends Error {
  constructor(detail: string) {
    super(`The model returned a response that could not be read: ${detail}`);
    this.name = 'MalformedResponseError';
  }
}
