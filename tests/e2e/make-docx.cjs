// A .docx built by hand for the gate: the real zip structure, deflated
// entries, Word's heading styles, and runs split mid-word the way Word leaves
// them after edits. Built at run time rather than committed, so the fixture
// is readable here and the gate never depends on a binary nobody can diff.
//
// The content mirrors tests/fixtures/cv-one-col.html, so the PDF and the Word
// paths are asserted against the same CV.
const zlib = require('node:zlib');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function paragraph(text, { style, bold, split } = {}) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  const run = (t) => `<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const runs = split && text.length > 4 ? run(text.slice(0, 3)) + run(text.slice(3)) : run(text);
  return `<w:p>${pPr}${runs}</w:p>`;
}

const PARAGRAPHS = [
  ['Ada M. Lovelace', { style: 'Title' }],
  ['Senior Full-Stack Engineer · Applied AI', { bold: true }],
  [
    'Twelve years building software that runs in production, most recently putting language models behind deterministic code rather than in front of it.',
  ],
  ['Orlando, Florida · ada@lovelace.test · +1 407 555 0142', { split: true }],
  ['linkedin.com/in/ada-lovelace · github.com/adalovelace · adalovelace.dev/work'],
  ['Experience', { style: 'Heading1' }],
  ['Founder & Full-Stack Developer, Nesty C.A. — Remote', { bold: true, split: true }],
  ['2023 – Present'],
  ['Founded a consultancy focused on automation and API integration.', { style: 'ListParagraph' }],
  ['Designed automation using a microservices architecture.', { style: 'ListParagraph' }],
  ['Internal Applications Developer, Analytical Engine Co. — Cocoa, FL', { bold: true }],
  ['2022 – Present'],
  ['Built internal web applications used daily by operations staff.', { style: 'ListParagraph' }],
  ['Backend Developer, Difference Engine Ltd. — Remote', { bold: true }],
  ['May 2019 – Aug 2020'],
  ['Built and maintained billing services.', { style: 'ListParagraph' }],
  ['Education', { style: 'Heading1' }],
  ['B.Sc. Systems Engineering — Universidad de Margarita (Unimar), 2012–2017'],
  ['Computer Science Diploma — María Auxiliadora II, 2008–2012'],
  ['Skills', { style: 'Heading1' }],
  ['TypeScript, NestJS, React, PostgreSQL, Python'],
];

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${PARAGRAPHS.map(
  ([t, o]) => paragraph(t, o),
).join('')}<w:sectPr/></w:body></w:document>`;
const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip with deflated entries, written field by field. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const deflated = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, deflated);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** The fixture CV as a .docx, as a Buffer. */
function makeCvDocx() {
  return zip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', RELS],
    ['word/document.xml', DOCUMENT_XML],
  ]);
}

module.exports = { makeCvDocx };

if (require.main === module) {
  const out = process.argv[2] ?? 'cv.docx';
  require('node:fs').writeFileSync(out, makeCvDocx());
  console.log(`wrote ${out}`);
}
