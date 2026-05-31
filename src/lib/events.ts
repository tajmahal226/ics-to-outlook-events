import { CalendarEvent } from '@/lib/ics';

export const EVENT_VALIDATION_WARNING_PREFIX = 'Event validation: ';

type EventValidationInput = Pick<CalendarEvent, 'summary'> & {
  startDate: Date | string | null | undefined;
  endDate: Date | string | null | undefined;
};

const REQUIRED_FIELD_LABELS: Array<[keyof Pick<CalendarEvent, 'summary'>, string]> = [
  ['summary', 'summary'],
];

export const isValidEventDate = (date: unknown): date is Date => date instanceof Date && !Number.isNaN(date.getTime());

const toDate = (value: Date | string | null | undefined) => {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) return new Date(value);
  return null;
};

const buildValidationWarning = (message: string) => `${EVENT_VALIDATION_WARNING_PREFIX}${message}`;

export const getEventValidationMessage = (warning: string) => warning.replace(EVENT_VALIDATION_WARNING_PREFIX, '');

export function validateEventFields(event: EventValidationInput): string[] {
  const warnings: string[] = [];

  REQUIRED_FIELD_LABELS.forEach(([field, label]) => {
    if (!String(event[field] || '').trim()) {
      warnings.push(buildValidationWarning(`Missing required ${label}.`));
    }
  });

  const startDate = toDate(event.startDate);
  const endDate = toDate(event.endDate);
  const hasValidStartDate = isValidEventDate(startDate);
  const hasValidEndDate = isValidEventDate(endDate);

  if (!hasValidStartDate) {
    warnings.push(buildValidationWarning('Start date is invalid.'));
  }

  if (!hasValidEndDate) {
    warnings.push(buildValidationWarning('End date is invalid.'));
  }

  if (hasValidStartDate && hasValidEndDate && endDate.getTime() <= startDate.getTime()) {
    warnings.push(buildValidationWarning('End date must be after start date.'));
  }

  return warnings;
}

export function validateCalendarEvent(event: CalendarEvent): string[] {
  return validateEventFields(event);
}

export const isEventValidationWarning = (warning: string) => warning.startsWith(EVENT_VALIDATION_WARNING_PREFIX);

export function mergeEventValidationWarnings(existingWarnings: string[] = [], validationWarnings: string[] = []) {
  return [...new Set([
    ...existingWarnings.filter((warning) => !isEventValidationWarning(warning)),
    ...validationWarnings,
  ])];
}

export function getBlockingValidationWarnings(event: CalendarEvent) {
  return validateCalendarEvent(event);
}

export function hasBlockingValidationWarnings(event: CalendarEvent) {
  return getBlockingValidationWarnings(event).length > 0;
}
