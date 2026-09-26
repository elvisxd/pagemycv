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
};

/** "June 2023" becomes 2023-06. "2019" stays 2019. "Present" becomes null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s || /^present$/i.test(s) || /^current$/i.test(s)) return null;
  const withMonth = s.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
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
  const parts = raw
    .split(/\s*[—–]\s*|\s+-\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { startedOn: null, endedOn: null };
  if (parts.length === 1) return { startedOn: parseDate(parts[0] ?? ''), endedOn: null };
  return { startedOn: parseDate(parts[0] ?? ''), endedOn: parseDate(parts[1] ?? '') };
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

function linkKind(url: string): string {
  if (/linkedin\.com/i.test(url)) return 'linkedin';
  if (/github\.com/i.test(url)) return 'github';
  return 'portfolio';
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

  const headLines = lines.slice(lines.indexOf(titleLine) + 1, 20);
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
  for (const line of lines.slice(0, 25)) {
    for (const m of line.matchAll(/(?:https?:\/\/)?((?:[\w-]+\.)+[\w-]+\/[\w\-./]*)/g)) {
      const url = `https://${(m[1] ?? '').replace(/^https?:\/\//, '')}`.replace(/[.,]$/, '');
      if (/\.(md|png|jpg|html)$/i.test(url) || seen.has(url)) continue;
      seen.add(url);
      links.push({ kind: linkKind(url), url });
    }
  }

  // Location, from the line that names relocation or remote.
  let city: string | null = null;
  let region: string | null = null;
  const locLine = lines.slice(0, 25).find((l) => /relocation|remote/i.test(l) && /,/.test(l));
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
    const [title = heading, employer = ''] = heading.split(DASH);
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
    work,
    education,
    links,
  };
}
