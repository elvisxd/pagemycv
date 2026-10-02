import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Column-aware: find a vertical gutter no text item crosses, with items on
// both sides across a good share of the page's lines. Read the left column
// top to bottom, then the right. Pages without such a gutter read as one.
function splitColumns(items, pageWidth) {
  const spans = items.map((i) => [i.x, i.x + i.w]);
  const step = pageWidth / 200;
  let best = null;
  for (let gx = pageWidth * 0.2; gx <= pageWidth * 0.8; gx += step) {
    const crosses = spans.some(([a, b]) => a < gx - 2 && b > gx + 2);
    if (crosses) continue;
    const left = spans.filter(([, b]) => b <= gx).length;
    const right = spans.filter(([a]) => a >= gx).length;
    const share = Math.min(left, right) / items.length;
    if (share >= 0.15 && (!best || share > best.share)) best = { gx, share };
  }
  if (!best) return [items];
  return [items.filter((i) => i.x + i.w <= best.gx), items.filter((i) => i.x >= best.gx)];
}
function toLines(items) {
  const rows = new Map();
  for (const it of items) {
    const y = Math.round(it.y);
    const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(it);
  }
  return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) =>
    its.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
}
const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), isEvalSupported: false, disableFontFace: true }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const { width } = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items.filter((i) => 'str' in i && i.str.trim()).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
  const cols = splitColumns(items, width);
  console.log(`-- page ${p}: ${cols.length} column(s)`);
  for (const c of cols) console.log(toLines(c).join('\n'), '\n');
}
