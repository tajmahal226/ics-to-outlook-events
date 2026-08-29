import { PROVIDERS, ProviderId, ProviderSettings } from './providers';

const STORAGE_KEY = 'smart-schedule.provider-settings';

/**
 * The key lives only in this browser and is never sent anywhere but the
 * provider the user chose. `localStorage` access is wrapped throughout: it
 * throws outright in some privacy modes, and the app must still render.
 */
export function loadSettings(): ProviderSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<ProviderSettings>;
    const info = PROVIDERS[parsed.providerId as ProviderId];
    if (!info) return null;

    return {
      providerId: info.id,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      // Fall back to current defaults so a stored model that has since been
      // retired does not wedge the app.
      textModel: parsed.textModel?.trim() || info.defaultTextModel,
      visionModel: parsed.visionModel?.trim() || info.defaultVisionModel,
    };
  } catch {
    return null;
  }
}

export function saveSettings(settings: ProviderSettings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function clearSettings(): boolean {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function defaultSettingsFor(providerId: ProviderId): ProviderSettings {
  const info = PROVIDERS[providerId];
  return {
    providerId,
    apiKey: '',
    textModel: info.defaultTextModel,
    visionModel: info.defaultVisionModel,
  };
}
