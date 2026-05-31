import { readFileSync } from 'node:fs';

const fixturePath = 'fixtures/long-document-event-after-15000.txt';
const fixture = readFileSync(fixturePath, 'utf8');
const eventTitle = 'Post-Truncation Strategy Roundtable';
const eventOffset = fixture.indexOf(eventTitle);

if (eventOffset === -1) {
  throw new Error(`${fixturePath} is missing the long-document fixture event title.`);
}

if (eventOffset <= 15000) {
  throw new Error(`${fixturePath} event title starts at ${eventOffset}, expected after 15,000 characters.`);
}

console.log(`${fixturePath}: event starts at character ${eventOffset}, after the old 15,000-character cutoff.`);
