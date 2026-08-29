import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { Trash2, Download, AlertCircle, Sparkles, HelpCircle } from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { UploadZone } from '@/components/UploadZone';
import { EventList } from '@/components/EventList';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SettingsDialog } from '@/components/SettingsDialog';
import { parseICS, generateCleanICS, CalendarEvent } from '@/lib/ics';
import { getBlockingValidationWarnings, getEventValidationMessage, mergeEventValidationWarnings, validateCalendarEvent, validateEventFields } from '@/lib/events';
import { ExtractionResultSchema } from '@/lib/eventSchema';
import { extractTextFromFile } from '@/lib/extractText';
import { ProviderSettings, createProvider, hasUsableProvider } from '@/lib/providers';
import { loadSettings } from '@/lib/settings';


const EXTRACTION_CHUNK_SIZE = 12000;
const MAX_EXTRACTION_CHUNKS = 25;
const MIN_NATURAL_BREAK_OFFSET = Math.floor(EXTRACTION_CHUNK_SIZE * 0.65);

// The waiting rail shows unknown slots rather than invented times: a placeholder
// reads as "nothing here yet", where a plausible-looking 11:00 would read as data.
const EMPTY_TIME_LABEL = '··:··';
const EMPTY_RAIL_SLOTS = ['slot-1', 'slot-2', 'slot-3'];

type TextChunkPlan = {
  chunks: string[];
  omittedCharacters: number;
};

type DefaultYearSource = 'user' | 'document' | 'filename' | 'current-year' | 'next-year';

type DefaultYearPlan = {
  year: number;
  source: DefaultYearSource;
  sourceLabel: string;
  supportingYears: number[];
  isAmbiguous: boolean;
};

const YEAR_PATTERN = /\b(?:19|20)\d{2}\b/g;
const LATE_YEAR_FALLBACK_MONTH = 9;

const extractYears = (value: string) => {
  const years = new Set<number>();

  for (const match of value.matchAll(YEAR_PATTERN)) {
    const year = Number(match[0]);
    if (year >= 1970 && year <= 2100) {
      years.add(year);
    }
  }

  return [...years].sort((a, b) => a - b);
};

const chooseClosestUsableYear = (years: number[], currentYear: number) => {
  const upcomingYear = years.find((year) => year >= currentYear);
  return upcomingYear ?? years[years.length - 1];
};

const getDateBasedFallbackYear = (now = new Date()) => {
  const currentYear = now.getFullYear();
  return now.getMonth() >= LATE_YEAR_FALLBACK_MONTH ? currentYear + 1 : currentYear;
};

const buildDefaultYearPlan = ({
  sourceText = '',
  fileName = '',
  userSelectedYear,
  now = new Date(),
}: {
  sourceText?: string;
  fileName?: string;
  userSelectedYear?: number | null;
  now?: Date;
}): DefaultYearPlan => {
  const currentYear = now.getFullYear();

  if (userSelectedYear) {
    return {
      year: userSelectedYear,
      source: 'user',
      sourceLabel: 'your selected default year',
      supportingYears: [userSelectedYear],
      isAmbiguous: false,
    };
  }

  const documentYears = extractYears(sourceText);
  if (documentYears.length > 0) {
    return {
      year: chooseClosestUsableYear(documentYears, currentYear),
      source: 'document',
      sourceLabel: documentYears.length === 1 ? 'the uploaded document text' : 'multiple years found in the document text',
      supportingYears: documentYears,
      isAmbiguous: documentYears.length > 1,
    };
  }

  const filenameYears = extractYears(fileName);
  if (filenameYears.length > 0) {
    return {
      year: chooseClosestUsableYear(filenameYears, currentYear),
      source: 'filename',
      sourceLabel: filenameYears.length === 1 ? 'the filename' : 'multiple years found in the filename',
      supportingYears: filenameYears,
      isAmbiguous: filenameYears.length > 1,
    };
  }

  const fallbackYear = getDateBasedFallbackYear(now);

  return {
    year: fallbackYear,
    source: fallbackYear === currentYear ? 'current-year' : 'next-year',
    sourceLabel: fallbackYear === currentYear ? 'the current calendar year' : 'the next calendar year',
    supportingYears: [fallbackYear],
    isAmbiguous: true,
  };
};

const describeDefaultYearPlan = (plan: DefaultYearPlan) => {
  const yearList = plan.supportingYears.join(', ');
  const ambiguityNote = plan.isAmbiguous ? ' Review events using this fallback because the source year is ambiguous.' : '';

  return `Default year: ${plan.year} from ${plan.sourceLabel}${yearList ? ` (${yearList})` : ''}.${ambiguityNote}`;
};

const buildEventExtractionPrompt = (chunk: string, chunkNumber: number, totalChunks: number, defaultYearPlan: DefaultYearPlan) => `You are a precision calendar extraction expert. Extract all individual calendar events (sessions, meetings, presentations) from this schedule text chunk.

This is chunk ${chunkNumber} of ${totalChunks}. Treat it as one section of a longer document and extract only events that are visible in this chunk.

CRITICAL INSTRUCTIONS:
- The event TITLE (summary) MUST be the specific session topic or the company name mentioned (e.g., "Meeting with Jack Henry & Associates, Inc. (JKHY US)").
- DO NOT use the conference title, document header, or generic page headers as the event summary.
- Prefer any explicit year in the event text, document context, or filename context before using a fallback year.
- When an event date is missing a year and no more specific year is visible in the chunk, use ${defaultYearPlan.year} as the default year (${defaultYearPlan.sourceLabel}).
- If the event year is inferred from a fallback, conflicting document years, or weak context, set ambiguousYear to true and explain why in yearInferenceReason.
- Ensure startDate and endDate are in ISO 8601 format.

Default year context for this upload:
${describeDefaultYearPlan(defaultYearPlan)}

Text to analyze:
${chunk}`;

const findNaturalBreak = (text: string, start: number, hardEnd: number) => {
  const earliestBreak = start + MIN_NATURAL_BREAK_OFFSET;
  const searchWindow = text.slice(earliestBreak, hardEnd);
  const breakPatterns = ['\n\n', '\n', '. ', '; '];

  for (const pattern of breakPatterns) {
    const relativeIndex = searchWindow.lastIndexOf(pattern);
    if (relativeIndex !== -1) {
      return earliestBreak + relativeIndex + pattern.length;
    }
  }

  return hardEnd;
};

export const splitTextIntoExtractionChunks = (text: string): TextChunkPlan => {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length && chunks.length < MAX_EXTRACTION_CHUNKS) {
    const hardEnd = Math.min(start + EXTRACTION_CHUNK_SIZE, text.length);
    const end = hardEnd === text.length ? hardEnd : findNaturalBreak(text, start, hardEnd);
    const chunk = text.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    start = end;
  }

  return {
    chunks,
    omittedCharacters: Math.max(text.length - start, 0),
  };
};

const normalizeDedupePart = (value: string | Date | undefined) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }

  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
};

const getEventDedupeKey = (event: CalendarEvent) => [
  normalizeDedupePart(event.summary),
  normalizeDedupePart(event.startDate),
  normalizeDedupePart(event.endDate),
  normalizeDedupePart(event.location),
].join('|');

const dedupeEvents = (eventsToDedupe: CalendarEvent[]) => {
  const seen = new Set<string>();

  return eventsToDedupe.filter((event) => {
    const key = getEventDedupeKey(event);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const getYearValidationWarnings = (event: any, defaultYearPlan: DefaultYearPlan) => {
  const warnings: string[] = [];
  const startYear = new Date(event.startDate).getFullYear();
  const endYear = new Date(event.endDate).getFullYear();
  const eventUsesDefaultYear = startYear === defaultYearPlan.year || endYear === defaultYearPlan.year;

  if (event.ambiguousYear) {
    warnings.push(event.yearInferenceReason || 'The AI marked this event year as ambiguous.');
  }

  if (eventUsesDefaultYear && defaultYearPlan.isAmbiguous && !event.yearSourceText) {
    warnings.push(`Year ${defaultYearPlan.year} was inferred from ${defaultYearPlan.sourceLabel}; review this event date before exporting.`);
  }

  return [...new Set(warnings)];
};

const mapAiEventToCalendarEvent = (event: any, defaultYearPlan: DefaultYearPlan): CalendarEvent => ({
  id: Math.random().toString(36).substr(2, 9),
  summary: event.summary,
  description: event.description || '',
  location: event.location || '',
  startDate: new Date(event.startDate),
  endDate: new Date(event.endDate),
  allDay: !!event.allDay,
  validationWarnings: getYearValidationWarnings(event, defaultYearPlan),
});


export default function App() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [rawText, setRawText] = useState<string>('');
  const [extractionStatus, setExtractionStatus] = useState<string>('');
  const [yearInferenceStatus, setYearInferenceStatus] = useState<string>('');
  const [explicitDefaultYear, setExplicitDefaultYear] = useState<number | null>(null);
  const [isPolishing, setIsPolishing] = useState<string | null>(null);
  // Read once on mount; localStorage can throw, and loadSettings absorbs that.
  const [settings, setSettings] = useState<ProviderSettings | null>(() => loadSettings());

  const canUseAi = hasUsableProvider(settings);

  const currentYear = new Date().getFullYear();
  const fallbackYearPreview = useMemo(() => buildDefaultYearPlan({ userSelectedYear: explicitDefaultYear }), [explicitDefaultYear]);
  const selectableYears = useMemo(() => Array.from({ length: 6 }, (_, index) => currentYear + index), [currentYear]);

  const handleFileLoaded = useCallback(async (file: File) => {
    setIsLoading(true);
    setRawText('');
    setExtractionStatus('');
    setYearInferenceStatus('');
    try {
      let extractedEvents: CalendarEvent[] = [];
      let partialExtractionStatus = '';

      if (file.name.toLowerCase().endsWith('.ics')) {
        const content = await file.text();
        extractedEvents = parseICS(content);
        setRawText(content);
        const defaultYearPlan = buildDefaultYearPlan({ sourceText: content, fileName: file.name, userSelectedYear: explicitDefaultYear });
        setYearInferenceStatus(`ICS import preserved event years from the calendar file. ${describeDefaultYearPlan(defaultYearPlan)}`);
      } else {
        // AI Extraction Flow. Requires a provider; .ics above never does.
        const provider = createProvider(settings);

        toast.info('Reading the document...', {
          description: 'The file is parsed on this device. Only the text it contains is sent on.',
          icon: <Sparkles className="w-5 h-5 text-primary" />,
        });

        // 1. Parse the file to text in the browser. Nothing is uploaded to be
        // read, so the document itself never leaves the device.
        const { text, looksLikeScan } = await extractTextFromFile(file);
        setRawText(text);

        if (!text) {
          throw new Error(
            looksLikeScan
              ? 'This looks like a scan, so there is no text to read. Reading scans is not supported yet.'
              : 'No text could be read from this file.'
          );
        }

        if (looksLikeScan) {
          toast.warning('This document may be a scan', {
            description: 'Very little text was found, so events may be missing. Reading scans is not supported yet.',
            icon: <AlertCircle className="w-5 h-5" />,
          });
        }

        const defaultYearPlan = buildDefaultYearPlan({ sourceText: text, fileName: file.name, userSelectedYear: explicitDefaultYear });
        const defaultYearDescription = describeDefaultYearPlan(defaultYearPlan);
        setYearInferenceStatus(defaultYearDescription);
        toast.info('Year inference ready', {
          description: defaultYearDescription,
        });

        // 2. Structure with AI in bounded chunks so events later in long
        // documents are not silently skipped after the old 15,000-character cut-off.
        const { chunks, omittedCharacters } = splitTextIntoExtractionChunks(text);

        if (chunks.length > 1) {
          toast.info(`Analyzing ${chunks.length} document sections with AI...`, {
            description: 'Long documents are split into bounded chunks and merged after extraction.',
            icon: <Sparkles className="w-5 h-5 text-primary" />,
          });
        }

        const chunkEvents: CalendarEvent[] = [];
        const skippedEventWarnings: string[] = [];

        for (const [index, chunk] of chunks.entries()) {
          if (chunks.length > 1) {
            toast.info(`Extracting section ${index + 1} of ${chunks.length}...`);
          }

          const result = await provider.extractEvents(
            buildEventExtractionPrompt(chunk, index + 1, chunks.length, defaultYearPlan),
            ExtractionResultSchema
          );

          result.events.forEach((event: any, eventIndex: number) => {
            const validationWarnings = validateEventFields({
              summary: event?.summary,
              startDate: event?.startDate,
              endDate: event?.endDate,
            });

            if (validationWarnings.length > 0) {
              const eventLabel = String(event?.summary || '').trim() || `section ${index + 1}, event ${eventIndex + 1}`;
              skippedEventWarnings.push(`${eventLabel}: ${validationWarnings.map(getEventValidationMessage).join(' ')}`);
              return;
            }

            const calendarEvent = mapAiEventToCalendarEvent(event, defaultYearPlan);
            calendarEvent.validationWarnings = mergeEventValidationWarnings(calendarEvent.validationWarnings, validateCalendarEvent(calendarEvent));
            chunkEvents.push(calendarEvent);
          });
        }

        extractedEvents = dedupeEvents(chunkEvents);

        if (skippedEventWarnings.length > 0) {
          const skippedDescription = skippedEventWarnings.slice(0, 3).join(' • ');
          toast.warning(`${skippedEventWarnings.length} invalid ${skippedEventWarnings.length === 1 ? 'event was' : 'events were'} skipped`, {
            description: skippedEventWarnings.length > 3 ? `${skippedDescription} • Review the source for more invalid rows.` : skippedDescription,
            icon: <AlertCircle className="w-5 h-5" />,
          });
        }

        if (omittedCharacters > 0) {
          partialExtractionStatus = `${omittedCharacters.toLocaleString()} characters were omitted after processing ${chunks.length} sections. Review the extracted events for completeness.`;
          setExtractionStatus(partialExtractionStatus);
          toast.warning('Partial extraction completed', {
            description: partialExtractionStatus,
            icon: <AlertCircle className="w-5 h-5" />,
          });
        }
      }

      if (extractedEvents.length === 0) {
        toast.error('No events found in this file');
        return;
      }

      setEvents(extractedEvents);
      setFileName(file.name);
      toast.success(`Successfully extracted ${extractedEvents.length} events`, {
        description: partialExtractionStatus || undefined,
      });
    } catch (error: any) {
      console.error('Extraction error:', error);
      toast.error('Failed to process file', {
        description: error.message || 'Check the file format and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [explicitDefaultYear, settings]);

  const handleDownloadIndividual = useCallback((event: CalendarEvent) => {
    const validationWarnings = getBlockingValidationWarnings(event);

    if (validationWarnings.length > 0) {
      toast.error('Fix this event before exporting', {
        description: validationWarnings.join(' '),
      });
      return;
    }

    try {
      const singleEventICS = generateCleanICS([event]);
      const blob = new Blob([singleEventICS], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute('download', `${event.summary.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('Individual event exported!');
    } catch (error) {
      toast.error('Failed to generate individual ICS');
    }
  }, []);

  const handleUpdateEvent = useCallback((eventId: string, updates: Partial<CalendarEvent>) => {
    setEvents(prev => prev.map((event) => {
      if (event.id !== eventId) return event;

      const updatedEvent = { ...event, ...updates };
      const validationWarnings = validateCalendarEvent(updatedEvent);

      return {
        ...updatedEvent,
        validationWarnings: mergeEventValidationWarnings(updatedEvent.validationWarnings, validationWarnings),
      };
    }));
  }, []);

  const handlePolishDescription = useCallback(async (eventId: string, description: string) => {
    setIsPolishing(eventId);
    try {
      const text = await createProvider(settings).polishText(
        `Clean up and format this calendar event description into professional bullet points. Remove any messy fragments or artifacts from PDF extraction. Keep it concise. Description: ${description}`
      );
      handleUpdateEvent(eventId, { description: text.trim() });
      toast.success('Description tidied up');
    } catch (error: any) {
      toast.error('Could not tidy up the description', {
        description: error?.message,
      });
    } finally {
      setIsPolishing(null);
    }
  }, [handleUpdateEvent, settings]);

  const handleExport = useCallback(() => {
    if (events.length === 0) return;

    const invalidEvents = events
      .map((event) => ({ event, validationWarnings: getBlockingValidationWarnings(event) }))
      .filter(({ validationWarnings }) => validationWarnings.length > 0);

    if (invalidEvents.length > 0) {
      toast.error('Fix invalid events before exporting', {
        description: `${invalidEvents.length} ${invalidEvents.length === 1 ? 'event has' : 'events have'} date or required-field issues.`,
      });
      return;
    }

    setIsLoading(true);

    try {
      const cleanedICS = generateCleanICS(events);
      const blob = new Blob([cleanedICS], { type: 'text/calendar;charset=utf-8' });
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute('download', `schedule_${fileName.split('.')[0] || 'calendar'}.ics`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('ICS file generated!', {
        description: 'You can now import this file directly into Outlook.',
        icon: <Download className="w-5 h-5 text-primary" />,
      });
    } catch (error) {
      toast.error('Failed to generate ICS file');
    } finally {
      setIsLoading(false);
    }
  }, [events, fileName]);

  const handleReset = useCallback(() => {
    setEvents([]);
    setFileName('');
    setRawText('');
    setExtractionStatus('');
    setYearInferenceStatus('');
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col bg-background text-[15px] text-foreground selection:bg-primary/10">
        <Toaster position="top-right" expand={false} richColors />

        {/* Navigation. The mark is the rail itself: a spine with one node on it. */}
        <nav className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-sm md:h-16 md:px-8">
          <div className="flex items-center gap-3">
            <div className="relative h-7 w-2 shrink-0" aria-hidden="true">
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary/40" />
              <div className="absolute left-1/2 top-2 h-[7px] w-[7px] -translate-x-1/2 bg-primary" />
            </div>
            <div className="flex min-w-0 items-baseline gap-2.5">
              <h1 className="truncate text-base font-bold tracking-tight md:text-lg">Smart Schedule</h1>
              <span className="eyebrow hidden sm:block">Agenda to Outlook</span>
            </div>
          </div>

          <div className="flex items-center gap-1 md:gap-2">
            <SettingsDialog settings={settings} onSettingsChange={setSettings} />

            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-2 rounded-sm px-2 text-muted-foreground hover:text-primary md:px-3"
                >
                  <HelpCircle className="h-4 w-4" />
                  <span className="hidden text-xs font-semibold xs:inline">How it works</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[92vw] max-w-xl rounded-sm border-border p-6 md:p-8">
                <DialogHeader>
                  <DialogTitle className="mb-2 text-xl font-bold tracking-tight md:text-2xl">How it works</DialogTitle>
                  <DialogDescription className="space-y-5 pt-1 text-left">
                    <span className="block space-y-1.5">
                      <span className="eyebrow block">Reads to the end</span>
                      <span className="block text-sm leading-relaxed text-muted-foreground">
                        Long agendas are split into sections and extracted one at a time, so a session on page nine is
                        found as reliably as one on page one. If any text is left over, the banner tells you how much.
                      </span>
                    </span>
                    <span className="block space-y-1.5">
                      <span className="eyebrow block">Marks what it guessed</span>
                      <span className="block text-sm leading-relaxed text-muted-foreground">
                        Dates missing a year get one inferred from the document, the filename, or the year you pick.
                        Every event resting on that guess is flagged in amber. Flagged events still export; events with
                        broken dates are held back in red until you fix them.
                      </span>
                    </span>
                    <span className="block space-y-1.5">
                      <span className="eyebrow block">Writes what Outlook expects</span>
                      <span className="block text-sm leading-relaxed text-muted-foreground">
                        The .ics follows Microsoft&rsquo;s requirements, attendees and all-day events included, so
                        importing is a double-click. Export the whole day or any single event.
                      </span>
                    </span>
                  </DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>

            <AnimatePresence>
              {events.length > 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    className="h-9 gap-2 rounded-sm px-2 text-muted-foreground hover:text-destructive md:px-3"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="hidden text-xs font-semibold xs:inline">Start over</span>
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </nav>

        <main className="flex-1 px-4 py-10 md:px-8 md:py-16">
          <div className="mx-auto w-full max-w-4xl">
            {/*
              * Everything in the empty state hangs off the rail, including the
              * headline — the spine is the page's left margin, not a widget
              * parked below the copy.
              */}
            {events.length === 0 ? (
              <div className="rail rail-draw">
                <div className="rail-row">
                  <div className="rail-time" />
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1] }}
                    className="rail-body pb-8 md:pb-12"
                  >
                    <p className="eyebrow mb-4">PDF &middot; Word &middot; Email &middot; Text &middot; ICS</p>
                    <h2 className="text-4xl font-extrabold leading-[1.04] tracking-[-0.035em] md:text-6xl">
                      Read the agenda once.
                    </h2>
                    <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
                      Drop in a conference schedule and every session lands on the rail below. Anything the extraction
                      wasn&rsquo;t certain about is marked, so you can fix it before it reaches your calendar.
                    </p>
                  </motion.div>
                </div>

                <div className="rail-row">
                  <div className="rail-time" />
                  <div className="rail-body">
                    <div className="border border-border bg-card px-4 py-4 md:px-5">
                      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                        <div className="min-w-0 space-y-1.5">
                          <p className="eyebrow">Default year</p>
                          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground md:text-sm">
                            {describeDefaultYearPlan(fallbackYearPreview)} The document text and filename are checked first.
                          </p>
                        </div>
                        <label className="flex shrink-0 flex-col gap-1.5">
                          <span className="eyebrow">Year</span>
                          <select
                            value={explicitDefaultYear ?? ''}
                            onChange={(event) => setExplicitDefaultYear(event.target.value ? Number(event.target.value) : null)}
                            className="field field-mono h-10 w-full md:w-40"
                          >
                            <option value="">Auto ({fallbackYearPreview.year})</option>
                            {selectableYears.map((year) => (
                              <option key={year} value={year}>{year}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {!canUseAi && (
                  <div className="rail-row">
                    <div className="rail-time" />
                    <div className="rail-body">
                      <div className="border-l-2 border-accent bg-card px-4 py-3">
                        <p className="eyebrow mark-amber mb-1">No AI provider yet</p>
                        <p className="text-xs leading-relaxed text-muted-foreground md:text-sm">
                          Calendar files (.ics) work right now — they are read on this device. To pull
                          events out of a PDF, Word file, email or text file, add your own API key in
                          Settings.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rail-row">
                  <div className="rail-time">{EMPTY_TIME_LABEL}</div>
                  <div className="rail-node rail-node-empty" aria-hidden="true" />
                  <div className="rail-body">
                    <UploadZone
                      onFileLoaded={handleFileLoaded}
                      isLoading={isLoading}
                      aiAvailable={canUseAi}
                    />
                  </div>
                </div>

                {/* The rail trails off rather than stopping: pending time, not empty rows. */}
                {EMPTY_RAIL_SLOTS.map((slot, slotIndex) => (
                  <div
                    className="rail-row"
                    key={slot}
                    aria-hidden="true"
                    style={{ opacity: 1 - (slotIndex + 1) * 0.28 }}
                  >
                    <div className="rail-time">{EMPTY_TIME_LABEL}</div>
                    <div className="rail-node rail-node-empty" />
                    <div className="rail-body">
                      <div className="rail-slot" style={{ width: `${100 - slotIndex * 26}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {yearInferenceStatus && (
                  <div className="border-l-2 border-primary bg-card px-4 py-3">
                    <p className="eyebrow mb-1">Year inference</p>
                    <p className="text-xs leading-relaxed text-muted-foreground md:text-sm">{yearInferenceStatus}</p>
                  </div>
                )}

                {extractionStatus && (
                  <div className="border-l-2 border-accent bg-card px-4 py-3">
                    <p className="eyebrow mark-amber mb-1">Partial extraction</p>
                    <p className="text-xs leading-relaxed text-muted-foreground md:text-sm">{extractionStatus}</p>
                  </div>
                )}

                <EventList
                  events={events}
                  onExport={handleExport}
                  onDownloadIndividual={handleDownloadIndividual}
                  onUpdateEvent={handleUpdateEvent}
                  onPolishDescription={handlePolishDescription}
                  rawText={rawText}
                  isLoading={isLoading}
                  isPolishing={isPolishing}
                />
              </div>
            )}
          </div>
        </main>

        <footer className="border-t border-border px-4 py-6 md:px-8">
          <p className="eyebrow">Smart Schedule &middot; {new Date().getFullYear()}</p>
        </footer>
      </div>
    </MotionConfig>
  );
}
