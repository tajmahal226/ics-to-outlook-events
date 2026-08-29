import { ProviderId } from './types';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Where to get a key, shown in the settings dialog. */
  keyUrl: string;
  keyHint: string;
  /** Cheap tier: this path only structures text that was already extracted. */
  defaultTextModel: string;
  /**
   * Reads pixels. Not the cheapest tier — providers downscale large images and
   * a scanned agenda becomes unreadable. See the design spec's OCR section.
   */
  defaultVisionModel: string;
  /** False until an adapter exists; such providers stay out of the dropdown. */
  implemented: boolean;
  /** Shown as a caveat in settings when non-empty. */
  note?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
    defaultTextModel: 'claude-haiku-4-5',
    // Haiku 4.5 is standard-resolution tier (1568px long edge) and downscales
    // a 300 DPI scan to roughly 130 DPI. Sonnet 5 is the cheapest Anthropic
    // model on the high-resolution tier.
    defaultVisionModel: 'claude-sonnet-5',
    implemented: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    defaultTextModel: 'gpt-5-nano',
    defaultVisionModel: 'gpt-5-mini',
    implemented: false,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-...',
    defaultTextModel: 'google/gemini-2.5-flash-lite',
    defaultVisionModel: 'google/gemini-2.5-flash',
    implemented: false,
  },
  xai: {
    id: 'xai',
    label: 'x.ai (Grok)',
    keyUrl: 'https://console.x.ai',
    keyHint: 'xai-...',
    defaultTextModel: 'grok-4.3',
    defaultVisionModel: 'grok-4.3',
    implemented: false,
    note: 'x.ai does not document how it preprocesses images, so scans and photos are unproven here.',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza...',
    defaultTextModel: 'gemini-2.5-flash-lite',
    defaultVisionModel: 'gemini-2.5-flash',
    implemented: false,
  },
};

export const IMPLEMENTED_PROVIDERS = Object.values(PROVIDERS).filter((p) => p.implemented);
