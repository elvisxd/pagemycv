// A CV arrives as the file the person already has. This decides which reader
// opens it, and refuses the ones nothing here can read, in words that say
// what to do instead.
import { extractDocxLines } from './docx-text';
import { extractPdfLines } from './pdf-text';
import type { ExtractedLine } from './text';

export type CvFileKind = 'pdf' | 'docx' | 'text';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * By extension first, then by type. Browsers report `application/msword` for
 * a `.doc` and sometimes an empty type for a `.docx` that came through a
 * download, so the name is the more reliable of the two.
 */
export function cvFileKind(filename: string, mimeType: string): CvFileKind | 'doc' | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (ext === 'pdf' || mimeType === PDF_MIME) return 'pdf';
  if (ext === 'docx' || mimeType === DOCX_MIME) return 'docx';
  if (ext === 'doc' || mimeType === 'application/msword') return 'doc';
  if (ext === 'md' || ext === 'txt' || /^text\//.test(mimeType)) return 'text';
  return null;
}

export const OLD_WORD_MESSAGE =
  'that is an old Word format (.doc), which this cannot read. In Word, choose Save As and pick .docx or PDF, then try again.';

/**
 * Read the file into lines. The bytes are the person's own; nothing here
 * sends them anywhere, and the PDF reader is configured to fetch nothing.
 */
export async function readCvFile(file: {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<{ kind: CvFileKind; lines: ExtractedLine[] }> {
  const kind = cvFileKind(file.name, file.type);
  if (kind === 'doc') throw new Error(OLD_WORD_MESSAGE);
  if (kind === null) {
    throw new Error(`${file.name} is not a PDF, a Word document (.docx) or a text file.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error('that file is empty');
  if (kind === 'pdf') return { kind, lines: await extractPdfLines(bytes) };
  if (kind === 'docx') return { kind, lines: await extractDocxLines(bytes) };
  const text = new TextDecoder().decode(bytes);
  return { kind, lines: text.split(/\r?\n/).map((t) => ({ text: t })) };
}
