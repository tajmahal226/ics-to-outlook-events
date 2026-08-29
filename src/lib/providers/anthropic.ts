import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { AiProvider, ImagePart, MalformedResponseError, ProviderSettings } from './types';

const MAX_TOKENS = 8000;

/**
 * `dangerouslyAllowBrowser` is required: the SDK refuses to run client-side
 * without it, precisely because it means a key is present in the page. That is
 * the accepted trade of a bring-your-own-key app with no backend — the key is
 * the user's own, scoped and revocable by them.
 *
 * Note what is deliberately NOT sent: no `thinking` and no `output_config.effort`.
 * Effort errors on Haiku 4.5, and this pipeline lets the user pick any model,
 * so the request stays on the surface every model accepts.
 */
export function createAnthropicProvider(settings: ProviderSettings): AiProvider {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    dangerouslyAllowBrowser: true,
  });

  const toContent = (prompt: string, images?: ImagePart[]) => {
    if (!images?.length) return prompt;

    // Images before text: the model reads them better in that order.
    return [
      ...images.map((image) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 },
      })),
      { type: 'text' as const, text: prompt },
    ];
  };

  return {
    async extractEvents<T>(prompt: string, schema: z.ZodType<T>, images?: ImagePart[]): Promise<T> {
      const response = await client.messages.parse({
        model: images?.length ? settings.visionModel : settings.textModel,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: toContent(prompt, images) as any }],
        output_config: { format: zodOutputFormat(schema as any) },
      });

      // parsed_output is null when the response could not be parsed against
      // the schema. Failing loudly here is the point: a silent null would be
      // indistinguishable from a chunk that genuinely held no events.
      if (response.parsed_output == null) {
        throw new MalformedResponseError('the response did not match the expected event schema');
      }

      return response.parsed_output as T;
    },

    async polishText(prompt: string): Promise<string> {
      const response = await client.messages.create({
        model: settings.textModel,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
    },

    async testConnection(): Promise<void> {
      await client.messages.create({
        model: settings.textModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Reply with the single character: ok' }],
      });
    },
  };
}
