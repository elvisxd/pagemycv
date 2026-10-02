import { readFileSync } from 'node:fs';
// Read the zip's central directory, find word/document.xml, inflate it with
// the platform's DecompressionStream, and pull paragraph text out of the XML
// with a regex (the real module will use DOMParser in the panel).
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
export async function docxDocumentXml(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = td.decode(buf.subarray(off + 46, off + 46 + nlen));
    if (name === 'word/document.xml') {
      const lnlen = dv.getUint16(lho + 26, true), lxlen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lxlen;
      const data = buf.subarray(start, start + csize);
      const raw = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
      if (!raw) throw new Error(`compression method ${method}`);
      return td.decode(raw);
    }
    off += 46 + nlen + xlen + clen;
  }
  throw new Error('no word/document.xml');
}
const xml = await docxDocumentXml(new Uint8Array(readFileSync(process.argv[2])));
const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
  const style = m[0].match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
  const text = [...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('');
  return `${style.padEnd(14)}| ${text}`;
});
console.log(paras.join('\n'));
