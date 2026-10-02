import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Group text items into lines by their y coordinate, then order lines top to
// bottom and items left to right. Two-column pages interleave here: that is
// the thing being measured.
export async function pdfLines(bytes) {
  const doc = await getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const it of content.items) {
      if (!('str' in it)) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({ x, str: it.str, hasEOL: it.hasEOL });
    }
    const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items] of ordered) {
      items.sort((a, b) => a.x - b.x);
      out.push(items.map((i) => i.str).join('').replace(/\s+/g, ' ').trim());
    }
    out.push('');
  }
  return out;
}

const file = process.argv[2];
const lines = await pdfLines(new Uint8Array(readFileSync(file)));
console.log(lines.join('\n'));
