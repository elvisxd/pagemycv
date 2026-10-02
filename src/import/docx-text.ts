// A .docx is a zip with `word/document.xml` inside. Reading one needs an
// inflater and an XML parser, and the browser has both: `DecompressionStream`
// and `DOMParser`. So this costs no dependency, which is why it exists as its
// own module rather than as a second use of a Word library.
//
// Measured in spikes/cv-file against a hand-built file with runs split
// mid-word, the way Word leaves them after edits: paragraphs come out whole,
// heading styles survive, and table cells come out cell by cell — which puts
// a two-column CV's columns in order without any of the work the PDF path
// needs.
import type { ExtractedLine } from './text';
import { tidy } from './text';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const STORED = 0;
const DEFLATED = 8;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // Not awaited before close: a large entry blocks the write until the
  // reader below drains it, and awaiting here would wait on ourselves.
  void writer.write(bytes as BufferSource);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Thrown for a file this module will not read. The message is for the panel. */
export class DocxError extends Error {}

/**
 * The one entry we need, found through the zip's central directory rather
 * than by scanning for local headers: the directory is authoritative about
 * sizes and methods, and a scan is fooled by a name that appears in data.
 */
export async function docxDocumentXml(buf: Uint8Array): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== END_OF_CENTRAL_DIRECTORY) eocd--;
  if (eocd < 0) throw new DocxError('that file is not a Word document: it is not a zip archive');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || dv.getUint32(off, true) !== CENTRAL_DIRECTORY) {
      throw new DocxError('that Word document is damaged: its directory does not read');
    }
    const method = dv.getUint16(off + 10, true);
    const compressedSize = dv.getUint32(off + 20, true);
    const nameLength = dv.getUint16(off + 28, true);
    const extraLength = dv.getUint16(off + 30, true);
    const commentLength = dv.getUint16(off + 32, true);
    const localHeader = dv.getUint32(off + 42, true);
    const name = decoder.decode(buf.subarray(off + 46, off + 46 + nameLength));
    if (name === 'word/document.xml') {
      if (dv.getUint32(localHeader, true) !== LOCAL_FILE_HEADER) {
        throw new DocxError('that Word document is damaged: its text entry does not read');
      }
      const localNameLength = dv.getUint16(localHeader + 26, true);
      const localExtraLength = dv.getUint16(localHeader + 28, true);
      const start = localHeader + 30 + localNameLength + localExtraLength;
      const data = buf.subarray(start, start + compressedSize);
      if (method === STORED) return decoder.decode(data);
      if (method === DEFLATED) return decoder.decode(await inflateRaw(data));
      throw new DocxError(`that Word document uses a compression (${method}) this cannot read`);
    }
    off += 46 + nameLength + extraLength + commentLength;
  }
  throw new DocxError('that file is not a Word document: it has no word/document.xml inside');
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Paragraphs, in document order, each split at its manual line breaks.
 *
 * Only `w:t` text is read, so field codes, deleted text under tracked
 * changes and comments stay out: a CV is what the person sees on the page,
 * and that is the only thing that should be proposed back to them.
 */
export function docxParagraphs(xml: string): ExtractedLine[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new DocxError('that Word document is damaged: its text is not readable XML');
  }
  const out: ExtractedLine[] = [];
  const paragraphs = doc.getElementsByTagNameNS(W, 'p');
  for (const p of Array.from(paragraphs)) {
    // Nested paragraphs do not exist in WordprocessingML, but a text box
    // inside a paragraph puts its own paragraphs under it; those are
    // reported by getElementsByTagNameNS on their own, so skip the outer
    // copy of their text by reading only runs that belong to this paragraph.
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? '';
    const heading = /^(heading|title|subtitle|ttulo|titre|berschrift)/i.test(
      style.normalize('NFD').replace(/[̀-ͯ]/g, ''),
    );
    let current = '';
    const flush = () => {
      out.push(heading ? { text: current, heading: true } : { text: current });
      current = '';
    };
    const walk = (node: Node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== 1) continue;
        const el = child as Element;
        if (el.namespaceURI !== W) continue;
        if (el.localName === 'p') continue; // a nested paragraph is visited on its own
        if (el.localName === 't') current += el.textContent ?? '';
        else if (el.localName === 'tab') current += ' ';
        else if (el.localName === 'br' || el.localName === 'cr') flush();
        else walk(el);
      }
    };
    walk(p);
    flush();
  }
  return tidy(out);
}

/** The text of a .docx, paragraph by paragraph. */
export async function extractDocxLines(bytes: Uint8Array): Promise<ExtractedLine[]> {
  return docxParagraphs(await docxDocumentXml(bytes));
}
