import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Trash2, Download, CheckCircle2, AlertCircle, Sparkles, HelpCircle } from 'lucide-react';
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
import { parseICS, generateCleanICS, CalendarEvent } from '@/lib/ics';
import { blink } from '@/lib/blink';


const EXTRACTION_CHUNK_SIZE = 12000;
const MAX_EXTRACTION_CHUNKS = 25;
const MIN_NATURAL_BREAK_OFFSET = Math.floor(EXTRACTION_CHUNK_SIZE * 0.65);

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

const EVENT_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Title of the event' },
          description: { type: 'string', description: 'Brief details about the event' },
          location: { type: 'string', description: 'Where the event takes place' },
          startDate: { type: 'string', description: 'ISO 8601 date string' },
          endDate: { type: 'string', description: 'ISO 8601 date string' },
          allDay: { type: 'boolean' },
          ambiguousYear: { type: 'boolean', description: 'True when the event year was inferred from weak, conflicting, or fallback context' },
          yearInferenceReason: { type: 'string', description: 'Short explanation of how the event year was chosen, especially if ambiguous' },
          yearSourceText: { type: 'string', description: 'Exact nearby source text containing an explicit year, when available' }
        },
        required: ['summary', 'startDate', 'endDate']
      }
    }
  },
  required: ['events']
};

export default function App() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [rawText, setRawText] = useState<string>('');
  const [extractionStatus, setExtractionStatus] = useState<string>('');
  const [yearInferenceStatus, setYearInferenceStatus] = useState<string>('');
  const [explicitDefaultYear, setExplicitDefaultYear] = useState<number | null>(null);
  const [isPolishing, setIsPolishing] = useState<string | null>(null);

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
        // AI Extraction Flow
        toast.info('Analyzing schedule with AI...', {
          description: 'Your document is sent directly for extraction without creating a public storage URL.',
          icon: <Sparkles className="w-5 h-5 text-primary" />,
        });

        // 1. Extract text directly from the uploaded file blob. This avoids
        // creating public storage objects or exposing original filenames in URLs.
        const extractedText = await blink.data.extractFromBlob(file);
        const text = Array.isArray(extractedText) ? extractedText.join('\n') : extractedText;
        setRawText(text);

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

        for (const [index, chunk] of chunks.entries()) {
          if (chunks.length > 1) {
            toast.info(`Extracting section ${index + 1} of ${chunks.length}...`);
          }

          const { object } = await blink.ai.generateObject({
            prompt: buildEventExtractionPrompt(chunk, index + 1, chunks.length, defaultYearPlan),
            schema: EVENT_SCHEMA as any,
          });

          chunkEvents.push(...((object as any).events || []).map((event: any) => mapAiEventToCalendarEvent(event, defaultYearPlan)));
        }

        extractedEvents = dedupeEvents(chunkEvents);

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
  }, [explicitDefaultYear]);

  const handleDownloadIndividual = useCallback((event: CalendarEvent) => {
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
    setEvents(prev => prev.map(e => e.id === eventId ? { ...e, ...updates } : e));
  }, []);

  const handlePolishDescription = useCallback(async (eventId: string, description: string) => {
    setIsPolishing(eventId);
    try {
      const { text } = await blink.ai.generateText({
        prompt: `Clean up and format this calendar event description into professional bullet points. Remove any messy fragments or artifacts from PDF extraction. Keep it concise. Description: ${description}`,
      });
      handleUpdateEvent(eventId, { description: text.trim() });
      toast.success('Description polished!');
    } catch (error) {
      toast.error('Failed to polish description');
    } finally {
      setIsPolishing(null);
    }
  }, [handleUpdateEvent]);

  const handleExport = useCallback(() => {
    if (events.length === 0) return;
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
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans text-[15px] selection:bg-primary/10">
      <Toaster position="top-right" expand={false} richColors />

      {/* Navigation */}
      <nav className="h-16 md:h-20 border-b border-border/50 backdrop-blur-xl bg-background/80 sticky top-0 z-50 px-4 md:px-6 flex items-center justify-between overflow-hidden">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 md:w-10 md:h-10 bg-primary rounded-lg md:rounded-xl flex items-center justify-center text-white shadow-lg shadow-primary/20 shrink-0">
            <Calendar className="w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div className="flex flex-col min-w-0">
            <h1 className="text-lg md:text-xl font-bold tracking-tight leading-none truncate">Smart Schedule</h1>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5 md:mt-1 opacity-60 hidden sm:block">AI Extraction Tool</span>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary gap-1.5 md:gap-2 h-9 md:h-10 rounded-lg md:rounded-xl px-2 md:px-4">
                <HelpCircle className="w-4 h-4" />
                <span className="hidden xs:inline">FAQ</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl w-[90vw] md:w-full rounded-2xl md:rounded-3xl p-6 md:p-8">
              <DialogHeader>
                <DialogTitle className="text-xl md:text-2xl font-black mb-2 md:mb-4">How it works</DialogTitle>
                <DialogDescription className="space-y-4 md:space-y-6 pt-2">
                  <div className="space-y-1.5 md:space-y-2">
                    <h4 className="font-bold text-foreground flex items-center gap-2 text-sm md:text-base">
                      <Sparkles className="w-4 h-4 text-primary" /> AI Power Extraction
                    </h4>
                    <p className="text-muted-foreground leading-relaxed text-xs md:text-sm">
                      Our advanced AI scans your unstructured text (from PDFs, emails, or docs) to automatically detect event titles, dates, times, and descriptions.
                    </p>
                  </div>
                  <div className="space-y-1.5 md:space-y-2">
                    <h4 className="font-bold text-foreground flex items-center gap-2 text-sm md:text-base">
                      <CheckCircle2 className="w-4 h-4 text-primary" /> Outlook Optimized
                    </h4>
                    <p className="text-muted-foreground leading-relaxed text-xs md:text-sm">
                      The generated .ics files are standardized to follow Microsoft Outlook's specific requirements, ensuring your events land in the right time zone every time.
                    </p>
                  </div>
                  <div className="space-y-1.5 md:space-y-2">
                    <h4 className="font-bold text-foreground flex items-center gap-2 text-sm md:text-base">
                      <Download className="w-4 h-4 text-primary" /> Supports All Files
                    </h4>
                    <p className="text-muted-foreground leading-relaxed text-xs md:text-sm">
                      Whether it's a conference PDF, a copy-pasted email body, or a plain text list, just upload it and let us handle the formatting.
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>

          <AnimatePresence>
            {events.length > 0 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/5 gap-1.5 md:gap-2 h-9 md:h-10 rounded-lg md:rounded-xl px-2 md:px-4 transition-all duration-300"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden xs:inline">Reset</span>
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1">
        <section className="relative py-8 md:py-16 px-4 md:px-6">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full pointer-events-none overflow-hidden opacity-10">
            <div className="absolute -top-24 -left-24 w-64 md:w-96 h-64 md:h-96 bg-primary/30 rounded-full blur-[80px] md:blur-[100px]" />
            <div className="absolute top-1/2 -right-24 w-64 md:w-96 h-64 md:h-96 bg-primary/20 rounded-full blur-[80px] md:blur-[100px]" />
          </div>

          <div className="max-w-4xl mx-auto text-center mb-8 md:mb-16">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black mb-4 md:mb-6 leading-[1.1] tracking-tight"
            >
              Turn <span className="text-primary italic">any document</span> into a schedule
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-base md:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed px-2"
            >
              Upload a conference PDF, an email, or a text list. Our AI extracts the events and generates an Outlook-ready file.
            </motion.p>
          </div>

          <div className="max-w-5xl mx-auto w-full">
            {events.length === 0 ? (
              <div className="space-y-4">
                <div className="glass-card rounded-2xl border border-border/50 p-4 text-left shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-foreground">Year inference default</p>
                      <p className="text-xs text-muted-foreground md:text-sm">
                        {describeDefaultYearPlan(fallbackYearPreview)} Source text and filenames are checked first after upload.
                      </p>
                    </div>
                    <label className="flex shrink-0 flex-col gap-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Default year
                      <select
                        value={explicitDefaultYear ?? ''}
                        onChange={(event) => setExplicitDefaultYear(event.target.value ? Number(event.target.value) : null)}
                        className="h-10 rounded-xl border border-border/60 bg-background px-3 text-sm font-semibold normal-case tracking-normal text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Auto ({fallbackYearPreview.year})</option>
                        {selectableYears.map((year) => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <UploadZone onFileLoaded={handleFileLoaded} isLoading={isLoading} />
              </div>
            ) : (
              <div className="space-y-4">
                {yearInferenceStatus && (
                  <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-left text-sm text-foreground shadow-sm">
                    <Calendar className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div>
                      <p className="font-semibold">Year inference used for this extraction</p>
                      <p className="text-muted-foreground">{yearInferenceStatus}</p>
                    </div>
                  </div>
                )}
                {extractionStatus && (
                  <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-900 shadow-sm">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Partial extraction notice</p>
                      <p>{extractionStatus}</p>
                    </div>
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
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border/50 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} Smart Schedule. Built for faster productivity.</p>
      </footer>
    </div>
  );
}
