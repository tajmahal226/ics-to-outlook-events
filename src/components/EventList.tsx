import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, MapPin, Clock, Info, CheckCircle, Download, FileText, LayoutGrid, ChevronRight, Eye, Tag, AlignLeft, Globe, Users, Plus, X, Pencil, Sparkles, ExternalLink, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CalendarEvent } from '@/lib/ics';
import { cn } from '@/lib/utils';

interface EventListProps {
  events: CalendarEvent[];
  rawText?: string;
  onExport: () => void;
  onDownloadIndividual: (event: CalendarEvent) => void;
  onUpdateEvent: (eventId: string, updates: Partial<CalendarEvent>) => void;
  onPolishDescription: (eventId: string, description: string) => Promise<void>;
  isLoading: boolean;
  isPolishing?: string | null;
}

export function EventList({ events, rawText, onExport, onDownloadIndividual, onUpdateEvent, onPolishDescription, isLoading, isPolishing }: EventListProps) {
  const [view, setView] = useState<'grid' | 'text'>('grid');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [newAttendee, setNewAttendee] = useState<string>('');
  const ambiguousYearEventCount = events.filter((event) => event.validationWarnings?.length).length;

  const addAttendee = (eventId: string, currentAttendees: string[] = []) => {
    if (!newAttendee || !newAttendee.includes('@')) return;
    onUpdateEvent(eventId, { attendees: [...currentAttendees, newAttendee] });
    setNewAttendee('');
  };

  const removeAttendee = (eventId: string, currentAttendees: string[], index: number) => {
    const updated = [...currentAttendees];
    updated.splice(index, 1);
    onUpdateEvent(eventId, { attendees: updated });
  };

  const getGoogleCalendarUrl = (event: CalendarEvent) => {
    const formatUrlDate = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, '');
    const start = formatUrlDate(event.startDate);
    const end = formatUrlDate(event.endDate);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.summary)}&dates=${start}/${end}&details=${encodeURIComponent(event.description)}&location=${encodeURIComponent(event.location)}`;
  };

  const getOutlookWebUrl = (event: CalendarEvent) => {
    return `https://outlook.office.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(event.summary)}&startdt=${event.startDate.toISOString()}&enddt=${event.endDate.toISOString()}&body=${encodeURIComponent(event.description)}&location=${encodeURIComponent(event.location)}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6 md:space-y-8 max-w-5xl mx-auto py-4 md:py-8 px-2 md:px-4"
    >
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 md:gap-6 pb-6 md:pb-8 border-b border-border/50">
        <div className="space-y-1">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight">Review Extraction</h2>
          <p className="text-muted-foreground flex items-center gap-2 text-xs md:text-sm">
            <CheckCircle className="w-3.5 h-3.5 md:w-4 md:h-4 text-primary" />
            {events.length} {events.length === 1 ? 'event' : 'events'} successfully parsed by AI.
          </p>
          {ambiguousYearEventCount > 0 && (
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-700 md:text-sm">
              <AlertCircle className="h-3.5 w-3.5 md:h-4 md:w-4" />
              {ambiguousYearEventCount} {ambiguousYearEventCount === 1 ? 'event has' : 'events have'} ambiguous inferred year warnings.
            </p>
          )}
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          <div className="bg-secondary p-1 rounded-xl flex items-center gap-1 w-full sm:w-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('grid')}
              className={cn(
                "h-9 rounded-lg gap-2 px-4 transition-all duration-200 flex-1 sm:flex-none",
                view === 'grid' ? "bg-white shadow-sm text-primary" : "text-muted-foreground"
              )}
            >
              <LayoutGrid className="w-4 h-4" />
              Events
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('text')}
              className={cn(
                "h-9 rounded-lg gap-2 px-4 transition-all duration-200 flex-1 sm:flex-none",
                view === 'text' ? "bg-white shadow-sm text-primary" : "text-muted-foreground"
              )}
            >
              <FileText className="w-4 h-4" />
              Source
            </Button>
          </div>

          <Button
            onClick={onExport}
            disabled={isLoading || events.length === 0}
            className="bg-primary hover:bg-primary/90 text-white px-6 h-11 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all duration-300 w-full sm:w-auto"
          >
            <Download className="w-4 h-4" />
            Export All (.ics)
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'grid' ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid gap-4 md:gap-6 sm:grid-cols-1 md:grid-cols-2"
          >
            {events.map((event, index) => (
              <motion.div
                key={event.id || index}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.03 }}
                className={cn(
                  "glass-card group relative p-4 md:p-6 rounded-2xl border transition-all duration-300 overflow-hidden",
                  expandedEventId === event.id ? "border-primary/50 shadow-primary/5 ring-1 ring-primary/20" : "border-border/50 hover:border-primary/30"
                )}
              >
                {/* Actions */}
                <div className="absolute top-3 right-3 md:top-4 md:right-4 flex items-center gap-1.5 md:gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setExpandedEventId(expandedEventId === event.id ? null : event.id)}
                    className={cn(
                      "h-8 rounded-lg gap-1.5 md:gap-2 px-2.5 md:px-3 shadow-sm transition-colors",
                      expandedEventId === event.id ? "bg-primary text-white hover:bg-primary/90" : "hover:bg-primary/10 hover:text-primary"
                    )}
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span className="text-[10px] md:text-xs font-bold uppercase tracking-wider">{expandedEventId === event.id ? 'Hide' : 'Inspect'}</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onDownloadIndividual(event)}
                    className="h-8 w-8 p-0 rounded-lg shadow-sm hover:bg-primary/10 hover:text-primary shrink-0"
                    title="Download individual ICS"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {event.validationWarnings?.length ? (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 pr-20 text-xs text-amber-900 md:pr-24">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-bold">Review inferred year</p>
                      <p>{event.validationWarnings[0]}</p>
                    </div>
                  </div>
                ) : null}

                <div className="flex items-start gap-3 md:gap-4 mb-4 pr-20 md:pr-24">
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-primary/10 rounded-lg md:rounded-xl flex items-center justify-center text-primary shrink-0 group-hover:scale-110 transition-transform duration-300">
                    <CalendarIcon className="w-5 h-5 md:w-6 md:h-6" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base md:text-lg font-bold truncate group-hover:text-primary transition-colors leading-tight">
                      {event.summary}
                    </h3>
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[10px] md:text-xs text-muted-foreground mt-1">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{format(event.startDate, 'MMM d, yyyy')}</span>
                      </div>
                      <span className="hidden xs:inline opacity-30">•</span>
                      <span>{event.allDay ? 'All Day' : format(event.startDate, 'h:mm a')}</span>
                    </div>
                  </div>
                </div>

                <AnimatePresence>
                  {expandedEventId === event.id ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-border/50 mt-4 pt-4 space-y-4"
                    >
                      <div className="grid grid-cols-1 gap-4">
                        {event.validationWarnings?.length ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                            <p className="mb-1 font-bold">Year validation warnings</p>
                            <ul className="list-disc space-y-1 pl-4">
                              {event.validationWarnings.map((warning, warningIndex) => (
                                <li key={warningIndex}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                            <Tag className="w-3 h-3" /> SUMMARY
                          </label>
                          <input
                            type="text"
                            value={event.summary}
                            onChange={(e) => onUpdateEvent(event.id, { summary: e.target.value })}
                            className="w-full bg-muted/50 p-2.5 rounded-lg text-sm font-medium border border-border/20 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                          />
                        </div>

                        <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                              <Clock className="w-3 h-3" /> START
                            </label>
                            <input
                              type="datetime-local"
                              value={format(event.startDate, "yyyy-MM-dd'T'HH:mm")}
                              onChange={(e) => onUpdateEvent(event.id, { startDate: new Date(e.target.value) })}
                              className="w-full bg-muted/50 p-2.5 rounded-lg text-xs font-mono border border-border/20 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all h-10"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                              <Clock className="w-3 h-3" /> END
                            </label>
                            <input
                              type="datetime-local"
                              value={format(event.endDate, "yyyy-MM-dd'T'HH:mm")}
                              onChange={(e) => onUpdateEvent(event.id, { endDate: new Date(e.target.value) })}
                              className="w-full bg-muted/50 p-2.5 rounded-lg text-xs font-mono border border-border/20 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all h-10"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                            <Globe className="w-3 h-3" /> LOCATION
                          </label>
                          <input
                            type="text"
                            value={event.location}
                            placeholder="Add location..."
                            onChange={(e) => onUpdateEvent(event.id, { location: e.target.value })}
                            className="w-full bg-muted/50 p-2.5 rounded-lg text-sm border border-border/20 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all h-10"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                              <AlignLeft className="w-3 h-3" /> DESCRIPTION
                            </label>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onPolishDescription(event.id, event.description)}
                              disabled={isPolishing === event.id || !event.description}
                              className="h-6 px-2 rounded-md gap-1.5 text-[10px] font-bold text-primary hover:bg-primary/10 transition-all"
                            >
                              {isPolishing === event.id ? (
                                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Sparkles className="w-3 h-3" />
                              )}
                              AI POLISH
                            </Button>
                          </div>
                          <textarea
                            value={event.description}
                            placeholder="Add description..."
                            onChange={(e) => onUpdateEvent(event.id, { description: e.target.value })}
                            className="w-full bg-muted/50 p-3 rounded-lg text-xs leading-relaxed border border-border/20 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all whitespace-pre-wrap min-h-[100px] resize-y"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
                            <Users className="w-3 h-3" /> ATTENDEES
                          </label>
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <input
                                type="email"
                                placeholder="Attendee email..."
                                value={newAttendee}
                                onChange={(e) => setNewAttendee(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addAttendee(event.id, event.attendees);
                                  }
                                }}
                                className="flex-1 bg-muted/50 p-2 rounded-lg text-sm border border-border/20 focus:outline-none focus:ring-1 focus:ring-primary/30 h-10"
                              />
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => addAttendee(event.id, event.attendees)}
                                className="h-10 px-3 rounded-lg"
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {event.attendees?.map((email, idx) => (
                                <div key={idx} className="bg-primary/5 text-primary text-[10px] font-bold px-2.5 py-1.5 rounded-full border border-primary/10 flex items-center gap-1.5">
                                  {email}
                                  <button 
                                    onClick={() => removeAttendee(event.id, event.attendees || [], idx)} 
                                    className="hover:text-destructive transition-colors shrink-0"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                              {(!event.attendees || event.attendees.length === 0) && (
                                <span className="text-[10px] text-muted-foreground italic">No attendees added</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 xs:grid-cols-2 gap-3 pt-2">
                          <a
                            href={getGoogleCalendarUrl(event)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 bg-white hover:bg-primary/5 text-primary border border-primary/20 h-11 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Add to Google
                          </a>
                          <a
                            href={getOutlookWebUrl(event)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 bg-white hover:bg-primary/5 text-primary border border-primary/20 h-11 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Add to Outlook
                          </a>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="space-y-3 pl-1 md:pl-16">
                      {event.location && (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <MapPin className="w-4 h-4 text-primary/60 shrink-0 mt-0.5" />
                          <span className="line-clamp-1">{event.location}</span>
                        </div>
                      )}

                      {event.description && (
                        <div className="bg-muted/30 p-3 rounded-xl border border-border/20">
                          <p className="text-xs italic text-muted-foreground line-clamp-2 leading-relaxed">
                            {event.description}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="text"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass-card rounded-2xl border border-border/50 overflow-hidden"
          >
            <div className="bg-muted/50 px-6 py-3 border-b border-border/50 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Extracted Source Text</span>
              <span className="text-xs text-muted-foreground">{rawText?.length || 0} characters</span>
            </div>
            <div className="p-6">
              <pre className="text-sm font-mono text-muted-foreground whitespace-pre-wrap break-words leading-relaxed max-h-[600px] overflow-y-auto custom-scrollbar">
                {rawText || 'No source text available.'}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
