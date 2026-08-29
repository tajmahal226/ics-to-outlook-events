import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { Download, Plus, X, Sparkles, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CalendarEvent } from '@/lib/ics';
import {
  getBlockingValidationWarnings,
  getEventValidationMessage,
  hasBlockingValidationWarnings,
  isEventValidationWarning,
  isValidEventDate,
} from '@/lib/events';
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

type RailRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'event'; key: string; event: CalendarEvent; index: number };

const UNDATED = 'undated';

const getDayKey = (event: CalendarEvent) =>
  isValidEventDate(event.startDate) ? format(event.startDate, 'yyyy-MM-dd') : UNDATED;

export function EventList({ events, rawText, onExport, onDownloadIndividual, onUpdateEvent, onPolishDescription, isLoading, isPolishing }: EventListProps) {
  const [view, setView] = useState<'schedule' | 'source'>('schedule');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [newAttendee, setNewAttendee] = useState<string>('');
  const eventsNeedingReviewCount = events.filter((event) => event.validationWarnings?.length).length;
  const invalidEventCount = events.filter(hasBlockingValidationWarnings).length;

  // A day marker is inserted whenever the date changes. Events keep their
  // original order — a conference agenda is already chronological, and
  // re-sorting would quietly move rows the reader is checking against the PDF.
  const rows = useMemo<RailRow[]>(() => {
    const built: RailRow[] = [];
    let previousDay: string | null = null;

    events.forEach((event, index) => {
      const dayKey = getDayKey(event);

      if (dayKey !== previousDay) {
        built.push({
          kind: 'day',
          key: `day-${dayKey}-${index}`,
          label: dayKey === UNDATED ? 'Date unreadable' : format(event.startDate, 'EEE d MMM yyyy'),
        });
        previousDay = dayKey;
      }

      built.push({ kind: 'event', key: event.id || `event-${index}`, event, index });
    });

    return built;
  }, [events]);

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

  const formatEventDate = (date: Date, formatString: string) => (isValidEventDate(date) ? format(date, formatString) : '--:--');
  const formatDateInputValue = (date: Date) => (isValidEventDate(date) ? format(date, "yyyy-MM-dd'T'HH:mm") : '');

  const getGoogleCalendarUrl = (event: CalendarEvent) => {
    if (hasBlockingValidationWarnings(event)) return '#';

    const formatUrlDate = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, '');
    const start = formatUrlDate(event.startDate);
    const end = formatUrlDate(event.endDate);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.summary)}&dates=${start}/${end}&details=${encodeURIComponent(event.description)}&location=${encodeURIComponent(event.location)}`;
  };

  const getOutlookWebUrl = (event: CalendarEvent) => {
    if (hasBlockingValidationWarnings(event)) return '#';

    return `https://outlook.office.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(event.summary)}&startdt=${event.startDate.toISOString()}&enddt=${event.endDate.toISOString()}&body=${encodeURIComponent(event.description)}&location=${encodeURIComponent(event.location)}`;
  };

  const renderEventCard = (event: CalendarEvent, index: number) => {
    const blocking = getBlockingValidationWarnings(event);
    const isBlocked = blocking.length > 0;
    // Advisory warnings are the ones the validator did NOT produce: the AI's
    // year-inference notes. They never block an export, so they never read red.
    const advisory = (event.validationWarnings || []).filter((warning) => !isEventValidationWarning(warning));
    const isExpanded = expandedEventId === event.id;

    return (
      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: Math.min(index * 0.035, 0.6), duration: 0.35, ease: [0.2, 0.7, 0.3, 1] }}
        className={cn(
          'border bg-card transition-colors duration-200',
          isBlocked ? 'border-border border-l-2 border-l-destructive'
            : advisory.length > 0 ? 'border-border border-l-2 border-l-accent'
            : 'border-border',
          isExpanded && 'border-primary'
        )}
      >
        <div className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold leading-snug tracking-tight">{event.summary}</h3>

            <p className="eyebrow mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
              <span>
                {event.allDay
                  ? 'All day'
                  : `${formatEventDate(event.startDate, 'HH:mm')}–${formatEventDate(event.endDate, 'HH:mm')}`}
              </span>
              {event.location ? <span className="truncate">{event.location}</span> : null}
            </p>

            {(isBlocked || advisory.length > 0) && (
              <div className="mt-3 space-y-1">
                {blocking.map((warning, warningIndex) => (
                  <p className="mark mark-oxide" key={`block-${warningIndex}`}>
                    <span aria-hidden="true">✕</span>
                    <span>{getEventValidationMessage(warning)}</span>
                  </p>
                ))}
                {advisory.map((warning, warningIndex) => (
                  <p className="mark mark-amber" key={`advice-${warningIndex}`}>
                    <span aria-hidden="true">◦</span>
                    <span>{warning}</span>
                  </p>
                ))}
              </div>
            )}

            {!isExpanded && event.description ? (
              <p className="prose-serif mt-3 line-clamp-2 text-muted-foreground">{event.description}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
              className="eyebrow h-8 rounded-sm px-2 hover:bg-secondary"
            >
              {isExpanded ? 'Close' : 'Edit'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDownloadIndividual(event)}
              disabled={isBlocked}
              className="h-8 w-8 rounded-sm p-0 hover:bg-secondary"
              title={isBlocked ? 'Fix the errors above to export this event' : 'Download this event as .ics'}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isExpanded ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-border"
            >
              <div className="space-y-4 p-4">
                <div className="space-y-1.5">
                  <label className="eyebrow block" htmlFor={`summary-${event.id}`}>Title</label>
                  <input
                    id={`summary-${event.id}`}
                    type="text"
                    value={event.summary}
                    onChange={(e) => onUpdateEvent(event.id, { summary: e.target.value })}
                    className="field"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 xs:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="eyebrow block" htmlFor={`start-${event.id}`}>Starts</label>
                    <input
                      id={`start-${event.id}`}
                      type="datetime-local"
                      value={formatDateInputValue(event.startDate)}
                      onChange={(e) => onUpdateEvent(event.id, { startDate: new Date(e.target.value) })}
                      className="field field-mono h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="eyebrow block" htmlFor={`end-${event.id}`}>Ends</label>
                    <input
                      id={`end-${event.id}`}
                      type="datetime-local"
                      value={formatDateInputValue(event.endDate)}
                      onChange={(e) => onUpdateEvent(event.id, { endDate: new Date(e.target.value) })}
                      className="field field-mono h-10"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="eyebrow block" htmlFor={`location-${event.id}`}>Location</label>
                  <input
                    id={`location-${event.id}`}
                    type="text"
                    value={event.location}
                    placeholder="Room, building, or dial-in"
                    onChange={(e) => onUpdateEvent(event.id, { location: e.target.value })}
                    className="field h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="eyebrow block" htmlFor={`description-${event.id}`}>Description</label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPolishDescription(event.id, event.description)}
                      disabled={isPolishing === event.id || !event.description}
                      className="eyebrow h-7 gap-1.5 rounded-sm px-2 hover:bg-secondary"
                    >
                      {isPolishing === event.id ? (
                        <span className="block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      Tidy up
                    </Button>
                  </div>
                  <textarea
                    id={`description-${event.id}`}
                    value={event.description}
                    placeholder="Notes carried over from the document"
                    onChange={(e) => onUpdateEvent(event.id, { description: e.target.value })}
                    className="field min-h-[110px] resize-y whitespace-pre-wrap leading-relaxed"
                  />
                </div>

                <div className="space-y-2">
                  <label className="eyebrow block" htmlFor={`attendee-${event.id}`}>Attendees</label>
                  <div className="flex gap-2">
                    <input
                      id={`attendee-${event.id}`}
                      type="email"
                      placeholder="name@firm.com"
                      value={newAttendee}
                      onChange={(e) => setNewAttendee(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addAttendee(event.id, event.attendees);
                        }
                      }}
                      className="field h-10 flex-1"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => addAttendee(event.id, event.attendees)}
                      className="h-10 rounded-sm px-3"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {event.attendees?.map((email, idx) => (
                      <span key={idx} className="eyebrow flex items-center gap-1.5 border border-border bg-background px-2 py-1">
                        {email}
                        <button
                          type="button"
                          onClick={() => removeAttendee(event.id, event.attendees || [], idx)}
                          className="shrink-0 transition-colors hover:text-destructive"
                          aria-label={`Remove ${email}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {(!event.attendees || event.attendees.length === 0) && (
                      <span className="text-xs text-muted-foreground">Nobody added yet</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 border-t border-border pt-4 xs:grid-cols-2">
                  <a
                    aria-disabled={isBlocked}
                    href={getGoogleCalendarUrl(event)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'eyebrow flex h-10 items-center justify-center gap-2 border border-border bg-background transition-colors hover:border-primary',
                      isBlocked && 'pointer-events-none opacity-40'
                    )}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Google
                  </a>
                  <a
                    aria-disabled={isBlocked}
                    href={getOutlookWebUrl(event)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'eyebrow flex h-10 items-center justify-center gap-2 border border-border bg-background transition-colors hover:border-primary',
                      isBlocked && 'pointer-events-none opacity-40'
                    )}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Outlook
                  </a>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    );
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-col gap-5 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">Review the day</h2>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="eyebrow">{events.length} {events.length === 1 ? 'event' : 'events'}</span>
            {eventsNeedingReviewCount > 0 && (
              <span className="eyebrow mark-amber">{eventsNeedingReviewCount} to review</span>
            )}
            {invalidEventCount > 0 && (
              <span className="eyebrow mark-oxide">{invalidEventCount} blocked</span>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:justify-end lg:gap-6">
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setView('schedule')}
              className={cn(
                'eyebrow -mb-px border-b-2 pb-2',
                view === 'schedule' ? 'eyebrow-ink border-primary' : 'border-transparent'
              )}
            >
              Schedule
            </button>
            <button
              type="button"
              onClick={() => setView('source')}
              className={cn(
                'eyebrow -mb-px border-b-2 pb-2',
                view === 'source' ? 'eyebrow-ink border-primary' : 'border-transparent'
              )}
            >
              Source text
            </button>
          </div>

          <Button
            onClick={onExport}
            disabled={isLoading || events.length === 0 || invalidEventCount > 0}
            className="eyebrow eyebrow-ink h-10 gap-2 rounded-sm bg-primary px-5 text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            title={invalidEventCount > 0 ? 'Fix the blocked events before exporting' : 'Download every event as one .ics'}
          >
            <Download className="h-4 w-4" />
            Export .ics
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {view === 'schedule' ? (
          <motion.div
            key="schedule"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="rail rail-draw"
          >
            {rows.map((row) =>
              row.kind === 'day' ? (
                <div className="rail-row" key={row.key}>
                  <div className="rail-time" />
                  <div className="rail-tick" aria-hidden="true" />
                  <div className="rail-body pb-3">
                    <h3 className="eyebrow eyebrow-ink">{row.label}</h3>
                  </div>
                </div>
              ) : (
                <div className="rail-row" key={row.key}>
                  <div className="rail-time">
                    {row.event.allDay ? 'ALL DAY' : formatEventDate(row.event.startDate, 'HH:mm')}
                  </div>
                  <div
                    aria-hidden="true"
                    className={cn(
                      'rail-node',
                      hasBlockingValidationWarnings(row.event) ? 'rail-node-oxide'
                        : row.event.validationWarnings?.length ? 'rail-node-amber'
                        : ''
                    )}
                  />
                  <div className="rail-body">{renderEventCard(row.event, row.index)}</div>
                </div>
              )
            )}
          </motion.div>
        ) : (
          <motion.div
            key="source"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="border border-border bg-card"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="eyebrow">Text read from the file</span>
              <span className="eyebrow">{(rawText?.length || 0).toLocaleString()} chars</span>
            </div>
            <pre className="custom-scrollbar max-h-[600px] overflow-y-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-muted-foreground">
              {rawText || 'No source text available.'}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
