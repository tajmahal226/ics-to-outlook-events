import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Check, AlertCircle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { IMPLEMENTED_PROVIDERS, PROVIDERS, ProviderId, ProviderSettings, createProvider } from '@/lib/providers';
import { defaultSettingsFor, saveSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

interface SettingsDialogProps {
  settings: ProviderSettings | null;
  onSettingsChange: (settings: ProviderSettings) => void;
}

type TestState = { status: 'idle' | 'testing' | 'ok' | 'failed'; message?: string };

export function SettingsDialog({ settings, onSettingsChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ProviderSettings>(settings ?? defaultSettingsFor('anthropic'));
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  // Reopening should show what is actually saved, not a stale edit.
  useEffect(() => {
    if (open) {
      setDraft(settings ?? defaultSettingsFor('anthropic'));
      setTest({ status: 'idle' });
    }
  }, [open, settings]);

  const info = PROVIDERS[draft.providerId];

  const changeProvider = (providerId: ProviderId) => {
    // Models are provider-specific, so carry the key over but reset the models.
    setDraft({ ...defaultSettingsFor(providerId), apiKey: draft.apiKey });
    setTest({ status: 'idle' });
  };

  const runTest = async () => {
    setTest({ status: 'testing' });
    try {
      await createProvider(draft).testConnection();
      setTest({ status: 'ok' });
    } catch (error: any) {
      setTest({ status: 'failed', message: error?.message || 'The provider rejected the request.' });
    }
  };

  const save = () => {
    const persisted = saveSettings(draft);
    onSettingsChange(draft);
    setOpen(false);
    toast.success('Settings saved', {
      description: persisted
        ? 'Your key is stored in this browser only.'
        : 'This browser blocked local storage, so the key lasts until you reload.',
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 rounded-sm px-2 text-muted-foreground hover:bg-secondary hover:text-foreground md:px-3"
        >
          <SettingsIcon className="h-4 w-4" />
          <span className="hidden text-xs font-semibold xs:inline">Settings</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] w-[92vw] max-w-xl overflow-y-auto rounded-sm border-border p-6 md:p-8">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight md:text-2xl">Settings</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
            Choose a provider and add your own API key. It is stored in this browser only and sent
            nowhere except the provider you pick. Calendar files (.ics) are read on this device and
            need no key at all.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <p className="eyebrow">Provider</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {IMPLEMENTED_PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => changeProvider(provider.id)}
                  className={cn(
                    'flex items-center justify-between border px-3 py-2.5 text-left text-sm font-semibold transition-colors',
                    draft.providerId === provider.id
                      ? 'border-primary bg-secondary'
                      : 'border-border bg-background hover:border-primary/60'
                  )}
                >
                  {provider.label}
                  {draft.providerId === provider.id && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
            {IMPLEMENTED_PROVIDERS.length < Object.keys(PROVIDERS).length && (
              <p className="text-xs text-muted-foreground">
                OpenAI, OpenRouter, x.ai and Gemini are next; only Anthropic is wired up so far.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="eyebrow block" htmlFor="api-key">API key</label>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.apiKey}
              placeholder={info.keyHint}
              onChange={(e) => {
                setDraft({ ...draft, apiKey: e.target.value });
                setTest({ status: 'idle' });
              }}
              className="field field-mono h-10"
            />
            <p className="text-xs text-muted-foreground">
              <a
                href={info.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
              >
                Get a {info.label} key <ExternalLink className="h-3 w-3" />
              </a>
              {' — '}a key with a spend limit is worth using here, since it lives in the browser.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="eyebrow block" htmlFor="text-model">Model for documents</label>
              <input
                id="text-model"
                type="text"
                spellCheck={false}
                value={draft.textModel}
                onChange={(e) => setDraft({ ...draft, textModel: e.target.value })}
                className="field field-mono h-10"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Reads text pulled from PDFs, Word files and email. A cheap model is fine.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="eyebrow block" htmlFor="vision-model">Model for scans and photos</label>
              <input
                id="vision-model"
                type="text"
                spellCheck={false}
                value={draft.visionModel}
                onChange={(e) => setDraft({ ...draft, visionModel: e.target.value })}
                className="field field-mono h-10"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Reads small text off an image, so it needs to be stronger than the one above.
              </p>
            </div>
          </div>

          {info.note && (
            <p className="mark mark-amber">
              <span aria-hidden="true">◦</span>
              <span>{info.note}</span>
            </p>
          )}

          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={runTest}
                disabled={!draft.apiKey.trim() || test.status === 'testing'}
                className="eyebrow h-9 rounded-sm border border-border px-3 hover:bg-secondary hover:text-foreground"
              >
                {test.status === 'testing' ? 'Testing' : 'Test connection'}
              </Button>

              {test.status === 'ok' && (
                <span className="mark text-[11px] text-muted-foreground">
                  <Check className="h-3.5 w-3.5" />
                  <span>Key works</span>
                </span>
              )}
              {test.status === 'failed' && (
                <span className="mark mark-oxide">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{test.message}</span>
                </span>
              )}
            </div>

            <Button
              onClick={save}
              disabled={!draft.apiKey.trim()}
              className="h-10 rounded-sm bg-primary px-5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
