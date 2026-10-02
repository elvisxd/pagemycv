// What a file reduces to before the CV parser sees it: lines of text, in
// reading order, with one bit of layout kept.
//
// Both extractors (PDF, DOCX) produce this and nothing richer on purpose. The
// parser works on words and shapes — a date range, a comma, a short line
// before a long one — because those are what every CV has, whatever made it.
// A parser that leaned on fonts or styles would work on the three CVs it was
// written against and nowhere else.

export interface ExtractedLine {
  text: string;
  /**
   * The file itself said this line stands out: a Word heading style, or a
   * PDF line set noticeably larger than the body. A hint for finding section
   * boundaries, never the only evidence — a CV with every line in one size
   * still has sections, and the words find them.
   */
  heading?: boolean;
}

/** Collapse whitespace, drop empties. Every extractor ends here. */
export function tidy(lines: ExtractedLine[]): ExtractedLine[] {
  const out: ExtractedLine[] = [];
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push(line.heading ? { text, heading: true } : { text });
  }
  return out;
}
