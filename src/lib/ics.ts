import ICAL from 'ical.js';

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string;
  location: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  attendees?: string[];
  validationWarnings?: string[];
}

export function parseICS(rawContent: string): CalendarEvent[] {
  try {
    const jcalData = ICAL.parse(rawContent);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');

    return vevents.map((vevent) => {
      const event = new ICAL.Event(vevent);
      
      return {
        id: event.uid || Math.random().toString(36).substr(2, 9),
        summary: event.summary || 'No Title',
        description: event.description || '',
        location: event.location || '',
        startDate: event.startDate.toJSDate(),
        endDate: event.endDate.toJSDate(),
        allDay: event.startDate.isDate,
      };
    });
  } catch (error) {
    console.error('Error parsing ICS:', error);
    throw new Error('Failed to parse ICS file. Please ensure it is a valid iCalendar file.');
  }
}

export function generateCleanICS(events: CalendarEvent[]): string {
  const comp = new ICAL.Component(['vcalendar', [], []]);
  comp.updatePropertyWithValue('prodid', '-//Blink//ICS to Outlook//EN');
  comp.updatePropertyWithValue('version', '2.0');
  comp.updatePropertyWithValue('calscale', 'GREGORIAN');
  comp.updatePropertyWithValue('method', 'PUBLISH');

  events.forEach((e) => {
    const vevent = new ICAL.Component('vevent');
    const event = new ICAL.Event(vevent);

    event.uid = e.id;
    event.summary = e.summary;
    event.description = e.description;
    event.location = e.location;

    // Handle attendees
    if (e.attendees && e.attendees.length > 0) {
      e.attendees.forEach(email => {
        const attendee = vevent.addPropertyWithValue('attendee', `mailto:${email}`);
        attendee.setParameter('cutype', 'INDIVIDUAL');
        attendee.setParameter('role', 'REQ-PARTICIPANT');
        attendee.setParameter('partstat', 'NEEDS-ACTION');
        attendee.setParameter('rsvp', 'TRUE');
      });
    }

    // Handle dates
    const start = ICAL.Time.fromJSDate(e.startDate, false);
    const end = ICAL.Time.fromJSDate(e.endDate, false);
    
    if (e.allDay) {
      start.isDate = true;
      end.isDate = true;
    }

    event.startDate = start;
    event.endDate = end;

    comp.addSubcomponent(vevent);
  });

  return comp.toString();
}
