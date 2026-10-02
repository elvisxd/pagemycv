// The one door to pdf.js. Nothing else imports `pdfjs-dist`; scripts/guard.mjs
// enforces it.
//
// Runs in the side panel, an extension page: it has a DOM, it can spawn the
// worker pdf.js wants, and it holds no key — the vault key lives in the
// service worker and the decrypted CV in the dedicated worker, so a PDF
// crafted to misbehave inside a parser finds nothing here worth having.
//
// Configured to touch nothing outside the file: no font or character-map
// URLs, no system fonts. (pdf.js 6 has no `eval` path left to turn off; the
// option that did so is gone.) The gate's "no request left the extension
// origin" check covers this path like every other.
import * as pdfjs from 'pdfjs-dist';
// Vite bundles the worker into the extension; nothing is fetched at runtime.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { ExtractedLine } from './text';
import { tidy } from './text';

let workerStarted = false;

function ensureWorker(): void {
  if (workerStarted) return;
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  workerStarted = true;
}

/** One positioned run of text, as pdf.js reports it, reduced to what we use. */
export interface Glyphs {
  str: string;
  /** Left edge, in page units. */
  x: number;
  /** Baseline, in page units; larger is higher on the page. */
  y: number;
  width: number;
  /** Font size, in page units. */
  height: number;
}

/**
 * Split a page's text into columns, when it has them.
 *
 * Measured in spikes/cv-file: a two-column CV read by y coordinate alone
 * interleaves the columns line by line — "elvis@example.test" glued to
 * "Marzo 2023 – Actualidad" — and no parser recovers from that. So look for
 * a vertical gutter that no run of text crosses, with a real share of the
 * page's text on each side, and read the left column top to bottom before
 * the right. A page without such a gutter is one column, which is what a
 * one-column page must remain: the same spike checked that too.
 */
export function splitColumns(items: readonly Glyphs[], pageWidth: number): Glyphs[][] {
  if (items.length < 8) return [items.slice()];
  const step = pageWidth / 200;
  let best: { gx: number; share: number } | null = null;
  for (let gx = pageWidth * 0.2; gx <= pageWidth * 0.8; gx += step) {
    const crosses = items.some((i) => i.x < gx - 2 && i.x + i.width > gx + 2);
    if (crosses) continue;
    const left = items.filter((i) => i.x + i.width <= gx).length;
    const right = items.filter((i) => i.x >= gx).length;
    const share = Math.min(left, right) / items.length;
    if (share >= 0.15 && (!best || share > best.share)) best = { gx, share };
  }
  if (!best) return [items.slice()];
  const gx = best.gx;
  return [items.filter((i) => i.x + i.width <= gx), items.filter((i) => i.x >= gx)];
}

/**
 * Group runs into lines by baseline, order lines top to bottom and runs left
 * to right. A line set clearly larger than the page's body text is marked as
 * a heading.
 */
export function toLines(items: readonly Glyphs[]): ExtractedLine[] {
  const rows = new Map<number, Glyphs[]>();
  for (const it of items) {
    const y = Math.round(it.y);
    let key = y;
    for (const k of rows.keys()) {
      if (Math.abs(k - y) <= 2) {
        key = k;
        break;
      }
    }
    const row = rows.get(key);
    if (row) row.push(it);
    else rows.set(key, [it]);
  }
  const heights = items
    .map((i) => i.height)
    .filter((h) => h > 0)
    .sort((a, b) => a - b);
  const body = heights[Math.floor(heights.length / 2)] ?? 0;
  const out: ExtractedLine[] = [];
  for (const [, row] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    row.sort((a, b) => a.x - b.x);
    const text = row.map((i) => i.str).join(' ');
    const tallest = Math.max(...row.map((i) => i.height));
    const words = text.trim().split(/\s+/).length;
    const heading = body > 0 && tallest >= body * 1.25 && words <= 6;
    out.push(heading ? { text, heading: true } : { text });
  }
  return tidy(out);
}

function glyphsOf(items: readonly unknown[]): Glyphs[] {
  const out: Glyphs[] = [];
  for (const raw of items) {
    const it = raw as Partial<TextItem>;
    if (typeof it.str !== 'string' || !it.str.trim() || !it.transform) continue;
    const [a, , , , x, y] = it.transform;
    out.push({
      str: it.str,
      x: x ?? 0,
      y: y ?? 0,
      width: it.width ?? 0,
      // The font size is the scale of the text matrix. `height` is the
      // run's own box and is 0 for some producers, so prefer the matrix.
      height: Math.abs(a ?? 0) || it.height || 0,
    });
  }
  return out;
}

/** The text of a PDF, page by page, columns untangled. */
export async function extractPdfLines(bytes: Uint8Array): Promise<ExtractedLine[]> {
  ensureWorker();
  const task = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    useSystemFonts: false,
    // No cMapUrl, no standardFontDataUrl: text extraction of an embedded
    // font needs neither, and setting either would be a URL to fetch.
  });
  const doc = await task.promise;
  try {
    const lines: ExtractedLine[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { width } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const column of splitColumns(glyphsOf(content.items), width)) {
        lines.push(...toLines(column));
      }
    }
    return lines;
  } finally {
    await task.destroy();
  }
}
