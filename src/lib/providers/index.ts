import { createAnthropicProvider } from './anthropic';
import { PROVIDERS } from './registry';
import { AiProvider, MissingApiKeyError, ProviderSettings } from './types';

export * from './types';
export * from './registry';

/**
 * Builds the provider for the current settings. Throws rather than returning
 * a null provider so callers cannot accidentally proceed without a key.
 */
export function createProvider(settings: ProviderSettings | null): AiProvider {
  if (!settings?.apiKey?.trim()) {
    throw new MissingApiKeyError();
  }

  switch (settings.providerId) {
    case 'anthropic':
      return createAnthropicProvider(settings);
    default: {
      const label = PROVIDERS[settings.providerId]?.label ?? settings.providerId;
      throw new Error(`${label} is not available yet. Choose another provider in Settings.`);
    }
  }
}

/** Whether an AI call can be made at all. `.ics` never needs this. */
export function hasUsableProvider(settings: ProviderSettings | null): boolean {
  return Boolean(settings?.apiKey?.trim() && PROVIDERS[settings.providerId]?.implemented);
}
