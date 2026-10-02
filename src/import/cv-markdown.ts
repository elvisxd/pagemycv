// Parses perfil/cv.md, the file that is already the single source of truth for
// the CV in Byte, into structured rows.
//
// This is deliberately forgiving about spacing and dash characters and strict
// about structure. A CV in Markdown has more variation than it looks: em dash
// and en dash both appear, date ranges are sometimes years and sometimes month
// plus year, and "Present" is not a date.

export interface ParsedWork {
  title: string;
  employer: string;
  location: string | null;
  isRemote: boolean;
  startedOn: string;
  endedOn: string | null;
  description: string | null;
}

export interface ParsedEducation {
  degree: string | null;
  institution: string;
  startedOn: string | null;
  endedOn: string | null;
}

export interface ParsedLink {
  kind: string;
  url: string;
}

export interface ParsedCv {
  legalFirst: string;
  legalLast: string;
  headline: string | null;
  summary: string | null;
  city: string | null;
  region: string | null;
  email: string | null;
  phone: string | null;
  work: ParsedWork[];
  education: ParsedEducation[];
  links: ParsedLink[];
}

/** Em dash, en dash, or a hyphen with spaces around it. */
const DASH = /\s+[—–]\s+|\s+-\s+/;

const MONTHS: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
  // Spanish. A CV written in Caracas says "Marzo 2023 – Actualidad", and the
  // file importer hands those words to the same reader as the Markdown one.
  ene: '01',
  enero: '01',
  febrero: '02',
  marzo: '03',
  abr: '04',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  ago: '08',
  agosto: '08',
  septiembre: '09',
  setiembre: '09',
  octubre: '10',
  noviembre: '11',
  dic: '12',
  diciembre: '12',
};

/** The words a CV uses for "still here", in the two languages this reads. */
export const CURRENT_WORDS =
  /^(present|current|now|today|ongoing|actualidad|actual|presente|hoy|a la fecha)$/i;

/** "June 2023" becomes 2023-06. "2019" stays 2019. "Present" becomes null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s || CURRENT_WORDS.test(s)) return null;
  // "Marzo de 2023" and "March, 2023" both mean the same month.
  const withMonth = s.match(/^([A-Za-z\u00C0-\u017F]+)\.?,?\s+(?:de\s+)?(\d{4})$/);
  if (withMonth) {
    const month = MONTHS[(withMonth[1] ?? '').toLowerCase()];
    if (month) return `${withMonth[2]}-${month}`;
  }
  const yearOnly = s.match(/^(\d{4})$/);
  if (yearOnly) return yearOnly[1] ?? null;
  return null;
}

/** Splits "2022 — Present" or "2012–2017" into a start and an end. */
export function parseRange(raw: string): { startedOn: string | null; endedOn: string | null } {
  // A bare hyphen counts here. "2012-2017" is what most people type, and this
  // input is already known to be a date range, so splitting on it cannot break
  // a hyphenated word the way it would in a job title.
  const parts = raw
    .split(/\s*[—–]\s*|\s+-\s+|(?<=\d)\s*-\s*(?=[A-Za-z0-9])/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { startedOn: null, endedOn: null };
  if (parts.length === 1) return { startedOn: parseDate(parts[0] ?? ''), endedOn: null };
  return { startedOn: parseDate(parts[0] ?? ''), endedOn: parseDate(parts[1] ?? '') };
}

export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

export function linkKind(url: string): string {
  if (/linkedin\.com/i.test(url)) return 'linkedin';
  if (/github\.com/i.test(url)) return 'github';
  return 'portfolio';
}

/**
 * A recognisable top-level domain, or an explicit scheme, followed by a path.
 * The old pattern matched any word.word/word, so prose like "shipped
 * v2.1/beta" or "Node.js/22 runtime" was stored as a link and rendered as one.
 */
const URL_RE =
  /(?:https?:\/\/[\w-]+(?:\.[\w-]+)+|(?:[\w-]+\.)+(?:com|org|net|io|dev|app|me|co|ai|sh|gg|xyz|es|ar|ve|uk|de))\/[\w\-./]*/gi;

/** Every link in a piece of text, normalised to https, images and pages dropped. */
export function extractLinks(text: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = `https://${(m[0] ?? '').replace(/^https?:\/\//, '')}`.replace(/[.,]$/, '');
    if (/\.(md|png|jpg|html)$/i.test(url)) continue;
    out.push({ kind: linkKind(url), url });
  }
  return out;
}

function sectionOf(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return end === -1 ? rest : rest.slice(0, end);
}

export function parseCvMarkdown(markdown: string): ParsedCv {
  const lines = markdown.split(/\r?\n/);

  const titleLine = lines.find((l) => /^#\s+/.test(l)) ?? '';
  const { first, last } = splitName(titleLine.replace(/^#\s+/, ''));

  // Relative to the heading. An absolute end meant that a CV whose "# Name"
  // sat past line 20, behind front matter or a table of contents, produced an
  // empty window and silently lost its headline and summary.
  const titleAt = lines.indexOf(titleLine);
  const headLines = lines.slice(titleAt + 1, titleAt + 21);
  const headlineLine = headLines.find((l) => /^\*\*.+\*\*\s*$/.test(l.trim()));
  const headline = headlineLine ? headlineLine.trim().replace(/^\*\*|\*\*$/g, '') : null;

  const summaryStart = headlineLine ? headLines.indexOf(headlineLine) + 1 : 0;
  const summaryLines: string[] = [];
  for (const line of headLines.slice(summaryStart)) {
    if (/^[-*]\s/.test(line) || /^#/.test(line) || /^>/.test(line)) break;
    if (line.trim()) summaryLines.push(line.trim());
    else if (summaryLines.length) break;
  }
  const summary = summaryLines.length ? summaryLines.join(' ') : null;

  // Links, from the bullet list under the headline.
  const links: ParsedLink[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(titleAt, titleAt + 26)) {
    // A recognisable top-level domain, or an explicit scheme. The old pattern
    // matched any word.word/word, so prose like "shipped v2.1/beta" or
    // "Node.js/22 runtime" was stored as a link and rendered as one.
    for (const link of extractLinks(line)) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      links.push(link);
    }
  }

  // Email and phone, from the same header block the links come from.
  //
  // Phase 1 parsed neither, so the vault held no email at all and a filled
  // application was missing the one field every board makes required. The
  // gate caught it: five fields written on a Lever form and the email box
  // still empty.
  const header = lines.slice(titleAt, titleAt + 26).join('\n');
  // A mailto: link or a bare address. Deliberately conservative about the
  // trailing characters, because a markdown link wraps the address in
  // punctuation that is not part of it.
  const emailMatch = header.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  const email = emailMatch ? emailMatch[0].replace(/[.,)\]]+$/, '') : null;
  // A phone number only where it is labelled as one. Any run of digits in a
  // CV header is far more likely to be a year, a postcode or a version.
  const phoneLine = lines
    .slice(titleAt, titleAt + 26)
    .find((l) => /\b(tel|phone|mobile|m[óo]vil|tel[ée]fono|whatsapp)\b/i.test(l));
  const phoneMatch = phoneLine?.match(/\+?[\d][\d\s().-]{6,}\d/);
  const phone = phoneMatch ? phoneMatch[0].trim().replace(/[\s.-]+$/, '') : null;

  // Location, from the line that names relocation or remote.
  let city: string | null = null;
  let region: string | null = null;
  // Only a bullet. A headline such as "**Senior Engineer, Remote**" matches the
  // same words and used to be stored as the city, so "*Senior Engineer" ended
  // up encrypted into contact.city_enc.
  const locLine = lines
    .slice(titleAt, titleAt + 26)
    .find((l) => /^[-*]\s+/.test(l) && /relocation|remote/i.test(l) && /,/.test(l));
  if (locLine) {
    const head = locLine.replace(/^[-*]\s*/, '').split('·')[0] ?? '';
    const bits = head.split(',').map((b) => b.trim());
    city = bits[0] || null;
    region = bits[1] || null;
  }

  // Experience.
  const work: ParsedWork[] = [];
  const expLines = sectionOf(lines, /^##\s+Experience\b/i);
  for (let i = 0; i < expLines.length; i++) {
    const line = expLines[i] ?? '';
    if (!/^###\s+/.test(line)) continue;
    const heading = line.replace(/^###\s+/, '').trim();
    // The employer is the last segment. "Senior Engineer — Payments — Stripe"
    // used to destructure the first two and drop Stripe entirely, which is an
    // ordinary CV heading shape. Everything before the last dash is the title,
    // so a team or a specialisation is kept rather than discarded.
    const segments = heading
      .split(DASH)
      .map((x) => x.trim())
      .filter(Boolean);
    const employer = segments.length > 1 ? (segments.pop() as string) : '';
    const title = segments.join(' — ') || heading;
    const meta = (expLines[i + 1] ?? '').trim();
    let startedOn: string | null = null;
    let endedOn: string | null = null;
    let location: string | null = null;
    let isRemote = false;
    if (/^\*.*\*$/.test(meta)) {
      const fields = meta
        .replace(/^\*|\*$/g, '')
        .split('·')
        .map((f) => f.trim());
      const range = parseRange(fields[0] ?? '');
      startedOn = range.startedOn;
      endedOn = range.endedOn;
      const where = fields[1] ?? '';
      isRemote = /^remote$/i.test(where);
      location = isRemote ? null : where || null;
    }
    const bullets: string[] = [];
    for (let j = i + 1; j < expLines.length; j++) {
      const l = expLines[j] ?? '';
      if (/^###\s+/.test(l)) break;
      if (/^[-*]\s+/.test(l)) bullets.push(l.replace(/^[-*]\s+/, '').trim());
      else if (bullets.length && /^\s+\S/.test(l)) {
        bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${l.trim()}`;
      }
    }
    work.push({
      title: title.trim(),
      employer: employer.trim(),
      location,
      isRemote,
      startedOn: startedOn ?? '',
      endedOn,
      description: bullets.length ? bullets.join('\n') : null,
    });
  }

  // Education, a bullet list rather than headings.
  const education: ParsedEducation[] = [];
  for (const line of sectionOf(lines, /^##\s+Education\b/i)) {
    if (!/^[-*]\s+/.test(line)) continue;
    const body = line.replace(/^[-*]\s+/, '').trim();
    const degreeMatch = body.match(/^\*\*(.+?)\*\*/);
    const degree = degreeMatch ? (degreeMatch[1] ?? null) : null;
    const after = body.replace(/^\*\*.+?\*\*/, '').replace(/^\s*[—–-]\s*/, '');
    const lastComma = after.lastIndexOf(',');
    const institution = (lastComma === -1 ? after : after.slice(0, lastComma)).trim();
    const range =
      lastComma === -1
        ? { startedOn: null, endedOn: null }
        : parseRange(after.slice(lastComma + 1));
    education.push({ degree, institution, ...range });
  }

  return {
    legalFirst: first,
    legalLast: last,
    headline,
    summary,
    city,
    region,
    email,
    phone,
    work,
    education,
    links,
  };
}
