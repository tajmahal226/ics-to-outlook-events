import { useState, useCallback } from 'react';
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
          allDay: { type: 'boolean' }
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
  const [isPolishing, setIsPolishing] = useState<string | null>(null);

  const handleFileLoaded = useCallback(async (file: File) => {
    setIsLoading(true);
    setRawText('');
    try {
      let extractedEvents: CalendarEvent[] = [];

      if (file.name.toLowerCase().endsWith('.ics')) {
        const content = await file.text();
        extractedEvents = parseICS(content);
        setRawText(content);
      } else {
        // AI Extraction Flow
        toast.info('Analyzing schedule with AI...', {
          description: 'This may take a moment for larger documents.',
          icon: <Sparkles className="w-5 h-5 text-primary" />,
        });

        // 1. Upload to storage
        const { publicUrl } = await blink.storage.upload(file, `uploads/${Date.now()}-${file.name}`);

        // 2. Extract text
        const extractedText = await blink.data.extractFromUrl(publicUrl);
        const text = Array.isArray(extractedText) ? extractedText.join('\n') : extractedText;
        setRawText(text);

        // 3. Structure with AI
        const { object } = await blink.ai.generateObject({
          prompt: `You are a precision calendar extraction expert. Extract all individual calendar events (sessions, meetings, presentations) from the schedule text below.

CRITICAL INSTRUCTIONS:
- The event TITLE (summary) MUST be the specific session topic or the company name mentioned (e.g., "Meeting with Jack Henry & Associates, Inc. (JKHY US)").
- DO NOT use the conference title, document header, or generic page headers as the event summary.
- If the year is missing, assume 2026.
- Ensure startDate and endDate are in ISO 8601 format.

Text to analyze:
${text.substring(0, 15000)}`,
          schema: EVENT_SCHEMA as any,
        });

        extractedEvents = (object as any).events.map((e: any) => ({
          id: Math.random().toString(36).substr(2, 9),
          summary: e.summary,
          description: e.description || '',
          location: e.location || '',
          startDate: new Date(e.startDate),
          endDate: new Date(e.endDate),
          allDay: !!e.allDay,
        }));
      }

      if (extractedEvents.length === 0) {
        toast.error('No events found in this file');
        return;
      }

      setEvents(extractedEvents);
      setFileName(file.name);
      toast.success(`Successfully extracted ${extractedEvents.length} events`);
    } catch (error: any) {
      console.error('Extraction error:', error);
      toast.error('Failed to process file', {
        description: error.message || 'Check the file format and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

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
              <UploadZone onFileLoaded={handleFileLoaded} isLoading={isLoading} />
            ) : (
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
