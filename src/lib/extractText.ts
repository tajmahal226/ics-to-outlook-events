/**
 * File → plain text, entirely in the browser.
 *
 * This replaces Blink's `extractFromBlob`, which uploaded the file for
 * server-side parsing. Documents now never leave the device to be read; only
 * the extracted text is sent, and only to the provider the user chose.
 *
 * Parsers are imported dynamically so a PDF library is not in the bundle for
 * someone who only ever drops a .txt.
 */

export interface TextExtractionResult {
  text: string;
  /**
   * True when the file parsed but yielded so little text that it is probably a
   * scan. The caller routes these to the vision path (step 3) rather than
   * extracting nothing and reporting no events.
   */
  looksLikeScan: boolean;
}

/** Below this many characters per page, a PDF is almost certainly a scan. */
const MIN_CHARS_PER_PDF_PAGE = 80;

const getExtension = (fileName: string) => {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
};

async function extractPdf(file: File): Promise<TextExtractionResult> {
  const pdfjs = await import('pdfjs-dist');

  // Vite needs the worker resolved as a URL asset; without this pdf.js falls
  // back to a fake worker and parses on the main thread, freezing the page.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  const text = pages.join('\n\n').trim();

  return {
    text,
    looksLikeScan: doc.numPages > 0 && text.length < doc.numPages * MIN_CHARS_PER_PDF_PAGE,
  };
}

async function extractDocx(file: File): Promise<TextExtractionResult> {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return { text: value.trim(), looksLikeScan: false };
}

async function extractEml(file: File): Promise<TextExtractionResult> {
  const { default: PostalMime } = await import('postal-mime');
  const email = await PostalMime.parse(await file.arrayBuffer());

  // The subject and date carry real scheduling information and are often the
  // only place a year appears, so they lead rather than being dropped.
  const header = [
    email.subject ? `Subject: ${email.subject}` : '',
    email.date ? `Date: ${email.date}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const body = email.text?.trim() || stripHtml(email.html || '');

  return { text: [header, body].filter(Boolean).join('\n\n').trim(), looksLikeScan: false };
}

function stripHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body?.textContent || '').replace(/\s+\n/g, '\n').trim();
}

/** Extensions this module can turn into text. */
export const TEXT_EXTENSIONS = ['txt', 'md', 'pdf', 'docx', 'eml'] as const;

export function canExtractText(fileName: string): boolean {
  return (TEXT_EXTENSIONS as readonly string[]).includes(getExtension(fileName));
}

export async function extractTextFromFile(file: File): Promise<TextExtractionResult> {
  switch (getExtension(file.name)) {
    case 'txt':
    case 'md':
      return { text: (await file.text()).trim(), looksLikeScan: false };
    case 'pdf':
      return extractPdf(file);
    case 'docx':
      return extractDocx(file);
    case 'eml':
      return extractEml(file);
    default:
      throw new Error(`Cannot read text from ${file.name}.`);
  }
}
