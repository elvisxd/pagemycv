// The CV as flat text — what a PDF or a Word file reduces to — read into the
// same structure the Markdown importer produces.
//
// The Markdown importer reads STRUCTURE: `# Name`, `## Experience`, `### Title
// — Employer`, a line of dates in italics. A file has none of that. What it
// has is words and shapes, and those are the same in every CV ever written:
// a section is a short line that says "Experience" or "Educación"; a role is
// a line with a date range near a line with a title; an email looks like an
// email. This reads those, in English and Spanish, and says what it could
// not find.
//
// It will be wrong sometimes. That is why nothing it returns reaches the
// vault without being shown first — see the review step in the side panel —
// and why every guess here is the conservative one: a field left empty is
// corrected in a second; a wrong value typed into an application is not.
import type { ParsedCv, ParsedEducation, ParsedLink, ParsedWork } from './cv-markdown';
import { CURRENT_WORDS, extractLinks, parseDate, splitName } from './cv-markdown';
import type { ExtractedLine } from './text';
import { tidy } from './text';

export interface ParsedCvFromText extends ParsedCv {
  /** What the reader could not find or had to guess at. Shown above the review. */
  warnings: string[];
}

type SectionKind = 'experience' | 'education' | 'skills' | 'summary' | 'contact' | 'other';

/** Section titles, as CVs actually write them, in the two languages read here. */
const SECTION_TITLES: readonly { kind: SectionKind; pattern: RegExp }[] = [
  {
    kind: 'experience',
    pattern:
      /^((work|professional|relevant|employment|career) )?(experience|history)$|^employment$|^experiencia( profesional| laboral)?$|^trayectoria( profesional| laboral)?$|^historial laboral$|^antecedentes laborales$/,
  },
  {
    kind: 'education',
    pattern:
      /^education( (and|&) training)?$|^academic (background|history)$|^educaci[oó]n$|^formaci[oó]n( acad[eé]mica)?$|^estudios$/,
  },
  {
    kind: 'skills',
    pattern:
      /^((technical|core|key|professional) )?skills$|^competenc(ies|ias)$|^habilidades( t[eé]cnicas)?$|^tecnolog[ií]as$|^herramientas$|^stack( t[eé]cnico)?$|^tech stack$/,
  },
  {
    kind: 'summary',
    pattern:
      /^((professional|career) )?(summary|profile|objective)$|^about( me)?$|^perfil( profesional)?$|^resumen( profesional)?$|^sobre m[ií]$|^acerca de m[ií]$|^objetivo( profesional)?$|^presentaci[oó]n$/,
  },
  {
    kind: 'contact',
    pattern:
      /^contact( (details|information|info))?$|^contacto$|^datos( de contacto| personales)?$/,
  },
  {
    kind: 'other',
    pattern:
      /^certifications?$|^certificaciones$|^(licenses?|licencias)( (and|&|y) certifications?)?$|^languages?$|^idiomas$|^projects?$|^proyectos$|^(awards|honou?rs)( (and|&) (awards|honou?rs))?$|^premios$|^reconocimientos$|^publications?$|^publicaciones$|^references?$|^referencias$|^interests$|^hobbies$|^intereses$|^volunteer(ing)?( (work|experience))?$|^voluntariado$|^links?$|^enlaces$|^courses?$|^cursos$|^training$|^capacitaci[oó]n$/,
  },
];

// Whole month names or their usual abbreviations, bounded: an open-ended
// `mar[a-z]*` read "Margarita, 2012" as a date, and the university lost its
// name to the calendar.
const MONTH =
  '\\b(?:jan(?:uary)?|feb(?:ruary|rero)?|mar(?:ch|zo)?|apr(?:il)?|abr(?:il)?|may(?:o)?|jun(?:e|io)?|jul(?:y|io)?|aug(?:ust)?|ago(?:sto)?|sep(?:t(?:ember|iembre)?)?|set(?:iembre)?|oct(?:ober|ubre)?|nov(?:ember|iembre)?|dec(?:ember)?|dic(?:iembre)?|ene(?:ro)?)\\.?';
/** "June 2023", "Marzo de 2023", "03/2023", "2023". */
const DATE = `(?:${MONTH},?\\s+(?:de\\s+)?\\d{4}|\\d{1,2}\\/\\d{4}|\\d{4})`;
const CURRENT = '(?:present|current|now|today|ongoing|actualidad|actual|presente|hoy|a la fecha)';
/** A whole range: a date, a dash, and a date or a "still here" word. */
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:[—–-]|to|a|hasta)\\s*(${DATE}|${CURRENT})`, 'i');
/** A date that may stand alone, for education lines that give only a year. */
const YEAR_RE = /\b(19|20)\d{2}\b/;

const REMOTE_RE = /^(remote|remoto|remota|teletrabajo|a distancia|home office|fully remote)$/i;
const ROLE_WORDS =
  /\b(engineer|developer|programmer|architect|designer|manager|director|lead|head|founder|co-?founder|consultant|analyst|scientist|specialist|intern|technician|coordinator|administrator|officer|associate|assistant|owner|cto|ceo|coo|vp|desarrollador(a)?|programador(a)?|ingenier[oa]|arquitect[oa]|diseñador(a)?|gerente|jefe|jefa|fundador(a)?|consultor(a)?|analista|especialista|t[eé]cnic[oa]|coordinador(a)?|administrador(a)?|asistente|practicante|becari[oa]|senior|junior|sr\.?|jr\.?)\b/i;
const COMPANY_WORDS =
  /\b(inc|ltd|llc|plc|gmbh|s\.?a\.?|c\.?a\.?|s\.?l\.?|s\.?r\.?l\.?|corp|corporation|co|company|group|grupo|bank|banco|labs|studio|agency|agencia|technologies|tecnolog[ií]as|solutions|soluciones|systems|sistemas|consulting|consultora|freelance|aut[oó]nomo|independiente|self-employed)\b\.?/i;
const DEGREE_WORDS =
  /\b(b\.?sc?\.?|b\.?a\.?|b\.?eng\.?|m\.?sc?\.?|m\.?a\.?|m\.?eng\.?|mba|ph\.?d\.?|bachelor|master|doctor|diploma|certificate|degree|associate|licenciatura|licenciad[oa]|ingenier[ií]a|ingenier[oa]|t[eé]cnico( superior)?|tecn[oó]log[oa]|maestr[ií]a|m[aá]ster|doctorado|grado|postgrado|posgrado|especializaci[oó]n|bachiller(ato)?)\b/i;
const INSTITUTION_WORDS =
  /\b(universi\w+|university|instituto|institute|college|school|escuela|colegio|academy|academia|polit[eé]cnic\w*|polytechnic|liceo|unidad educativa|facultad|faculty)\b/i;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_LABEL = /\b(tel|tlf|phone|mobile|cell|m[óo]vil|celular|tel[ée]fono|whatsapp)\b\.?:?/i;
/** A phone: labelled, or international (+..), or a long run of digits with separators. */
const PHONE_RE = /\+?\(?\d[\d\s().-]{7,}\d/;
const BULLET_RE = /^[•·▪▫◦‣⁃○●■□\-–—*>]\s*/;

function stripBullet(text: string): string {
  return text.replace(BULLET_RE, '').trim();
}

function sectionKindOf(line: ExtractedLine): SectionKind | null {
  const text = line.text
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.split(' ').length > 5) return null;
  const lower = text.toLowerCase();
  for (const { kind, pattern } of SECTION_TITLES) if (pattern.test(lower)) return kind;
  return null;
}

/** A date range inside a line, and the line with the range taken out. */
function rangeIn(
  text: string,
): { startedOn: string | null; endedOn: string | null; rest: string } | null {
  const m = text.match(RANGE_RE);
  if (!m) return null;
  const startedOn = dateOf(m[1] ?? '');
  const end = m[2] ?? '';
  const endedOn = CURRENT_WORDS.test(end.replace(/\.$/, '')) ? null : dateOf(end);
  if (!startedOn) return null;
  const rest = text.replace(m[0], ' ').replace(/\s+/g, ' ').trim();
  return { startedOn, endedOn, rest };
}

function dateOf(raw: string): string | null {
  const s = raw.trim().replace(/,/, '');
  const slash = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[2]}-${(slash[1] ?? '').padStart(2, '0')}`;
  return parseDate(s);
}

function looksLikeUrl(text: string): boolean {
  return extractLinks(text).length > 0 || /\b(www\.|https?:\/\/)/i.test(text);
}

/** "Orlando, Florida" — two short parts, letters only. Not "Dear Sir, I". */
function locationIn(segment: string): { city: string; region: string } | null {
  const m = segment.trim().match(/^([\p{L} .'’-]{2,40}),\s*([\p{L} .'’-]{2,40})$/u);
  if (!m) return null;
  const city = (m[1] ?? '').trim();
  const region = (m[2] ?? '').trim();
  if (city.split(' ').length > 3 || region.split(' ').length > 3) return null;
  if (/\b(open|available|willing|disponible|abierto|dear|estimad)/i.test(segment)) return null;
  return { city, region };
}

function segmentsOf(text: string): string[] {
  return text
    .split(/\s*[·•|]\s*|\s+[—–]\s+|\s+-\s+|\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does this read as a person's name rather than a title or a sentence? */
function looksLikeName(text: string): boolean {
  if (text.length > 60 || /[\d@:/]/.test(text) || looksLikeUrl(text)) return false;
  const words = text.replace(/[,.]/g, '').split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  const particles = /^(de|del|la|las|los|y|e|da|do|dos|das|van|von|der|den|di|le|du|bin|al|el)$/i;
  return words.every((w) => /^\p{Lu}/u.test(w) || particles.test(w)) && !ROLE_WORDS.test(text);
}

/** Title and employer out of one heading, whichever order the CV used. */
function splitHeading(heading: string): {
  title: string;
  employer: string;
  location: string | null;
  isRemote: boolean;
} {
  const parts = heading
    .replace(/\s+(at|@|en|para)\s+/i, ' — ')
    .split(/\s*[·•|]\s*|\s+[—–]\s+|\s+-\s+|,\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  let isRemote = false;
  const named: string[] = [];
  // "Cocoa, FL" was split on its comma like everything else; the pieces
  // after title and employer that read as a place are joined back.
  const place: string[] = [];
  for (const p of parts) {
    if (REMOTE_RE.test(p)) isRemote = true;
    else if (named.length >= 2 && place.length < 2 && /^[\p{L} .'’-]{2,40}$/u.test(p))
      place.push(p);
    else named.push(p);
  }
  let location: string | null = place.length ? place.join(', ') : null;
  if (named.length === 0) return { title: heading, employer: '', location, isRemote };
  if (named.length === 1) return { title: named[0] ?? heading, employer: '', location, isRemote };
  let [a, b] = [named[0] ?? '', named[1] ?? ''];
  // Role words decide which is the title; failing that, company words decide
  // which is the employer; failing both, title first, which is the commoner
  // order in the CVs this was written against.
  const aRole = ROLE_WORDS.test(a);
  const bRole = ROLE_WORDS.test(b);
  if (bRole && !aRole) [a, b] = [b, a];
  else if (aRole === bRole && COMPANY_WORDS.test(a) && !COMPANY_WORDS.test(b)) [a, b] = [b, a];
  // A third named part that is not a place is still worth keeping: "Payments
  // team" belongs with the title rather than being thrown away.
  const extra = named.slice(2).filter((p) => p !== location);
  if (extra.length && !location) {
    const place = extra.find((p) => locationIn(`${p}, x`) || /^[\p{L} .'’-]{2,30}$/u.test(p));
    if (place && !ROLE_WORDS.test(place)) location = place;
  }
  return { title: a, employer: b, location, isRemote };
}

function placeFrom(rest: string): { location: string | null; isRemote: boolean } {
  let location: string | null = null;
  let isRemote = false;
  for (const seg of segmentsOf(rest)) {
    if (REMOTE_RE.test(seg)) isRemote = true;
    else if (!location && /^[\p{L} .'’,-]{2,40}$/u.test(seg) && !/\b(and|y)\b/.test(seg))
      location = seg;
  }
  return { location, isRemote };
}

interface Draft {
  heading: string | null;
  startedOn: string | null;
  endedOn: string | null;
  hasDates: boolean;
  location: string | null;
  isRemote: boolean;
  bullets: string[];
}

function newDraft(): Draft {
  return {
    heading: null,
    startedOn: null,
    endedOn: null,
    hasDates: false,
    location: null,
    isRemote: false,
    bullets: [],
  };
}

function isHeadingShaped(text: string): boolean {
  const t = stripBullet(text);
  return (
    t.length > 0 &&
    t.length <= 120 &&
    t.split(/\s+/).length <= 14 &&
    !/[.!?]$/.test(t) &&
    !BULLET_RE.test(text) &&
    !EMAIL_RE.test(t)
  );
}

/** Roles out of the experience lines. The shapes it handles are in the tests. */
function parseExperience(lines: readonly string[], warnings: string[]): ParsedWork[] {
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  const close = () => {
    if (current && (current.heading || current.hasDates)) drafts.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';
    const range = rangeIn(text);
    if (range) {
      if (current && !current.hasDates && current.heading) {
        // Title first, dates on the next line: the common shape.
        current.startedOn = range.startedOn;
        current.endedOn = range.endedOn;
        current.hasDates = true;
        const place = placeFrom(range.rest);
        current.location = current.location ?? place.location;
        current.isRemote = current.isRemote || place.isRemote;
        continue;
      }
      // Dates first, or dates and title on one line: a new role either way.
      close();
      current = newDraft();
      current.startedOn = range.startedOn;
      current.endedOn = range.endedOn;
      current.hasDates = true;
      const rest = range.rest.replace(/^[·•|,\-–—\s]+|[·•|,\-–—\s]+$/g, '');
      if (rest && isHeadingShaped(rest) && !/^[\p{L} .'’-]{2,30}$/u.test(rest)) {
        current.heading = rest;
      } else if (rest) {
        const place = placeFrom(rest);
        current.location = place.location;
        current.isRemote = place.isRemote;
      }
      continue;
    }

    const next = lines[i + 1] ?? '';
    const after = lines[i + 2] ?? '';
    if (current?.hasDates && !current.heading && isHeadingShaped(text)) {
      // Dates came first; this is the title line that follows them.
      current.heading = stripBullet(text);
      continue;
    }
    const nextHasRange = rangeIn(next) !== null;
    const twoLineHeading =
      !nextHasRange && rangeIn(after) !== null && isHeadingShaped(next) && !BULLET_RE.test(next);
    if (isHeadingShaped(text) && (nextHasRange || twoLineHeading)) {
      // A title whose dates follow: the next role starts here.
      close();
      current = newDraft();
      current.heading = stripBullet(text);
      if (twoLineHeading) {
        current.heading = `${current.heading} — ${stripBullet(next)}`;
        i++;
      }
      continue;
    }
    if (current && (current.heading || current.hasDates)) {
      // Anything else under a role is its description. A wrapped bullet
      // continues the previous one; a fresh bullet starts another.
      const body = stripBullet(text);
      // PDF text often loses the bullet glyph itself, so a line that follows
      // a finished sentence is a new point, and one that follows an
      // unfinished sentence is the rest of it.
      const previous = current.bullets[current.bullets.length - 1] ?? '';
      if (BULLET_RE.test(text) || current.bullets.length === 0 || /[.!?:;]$/.test(previous)) {
        current.bullets.push(body);
      } else {
        const last = current.bullets.length - 1;
        current.bullets[last] = `${current.bullets[last]} ${body}`;
      }
    }
  }
  close();

  const work: ParsedWork[] = [];
  let undated = 0;
  for (const d of drafts) {
    const split = splitHeading(d.heading ?? '');
    if (!d.hasDates) undated++;
    work.push({
      title: split.title || '(untitled role)',
      employer: split.employer,
      location: d.isRemote || split.isRemote ? null : (d.location ?? split.location),
      isRemote: d.isRemote || split.isRemote,
      startedOn: d.startedOn ?? '',
      endedOn: d.endedOn,
      description: d.bullets.length ? d.bullets.join('\n') : null,
    });
  }
  if (undated) warnings.push(`${undated} role(s) have no dates the reader could find`);
  const employerless = work.filter((w) => !w.employer).length;
  if (employerless)
    warnings.push(
      `${employerless} role(s) have no employer the reader could tell apart from the title`,
    );
  return work;
}

/** Degrees out of the education lines: a line with a year closes an entry. */
function parseEducation(lines: readonly string[]): ParsedEducation[] {
  const out: ParsedEducation[] = [];
  let pending: string[] = [];
  const flush = (dated: string | null) => {
    const text = [...pending, dated ?? ''].filter(Boolean).join(' — ');
    pending = [];
    if (!text) return;
    const range = rangeIn(text);
    let startedOn = range?.startedOn ?? null;
    let endedOn = range?.endedOn ?? null;
    let rest = range ? range.rest : text;
    if (!range) {
      const year = text.match(YEAR_RE);
      if (year) {
        endedOn = year[0];
        rest = text.replace(year[0], ' ');
      }
    }
    if (!range && !startedOn) startedOn = null;
    const parts = rest
      .split(/\s*[·•|]\s*|\s+[—–]\s+|\s+-\s+|,\s+/)
      .map((p) => p.trim().replace(/^[,\-–—\s]+|[,\-–—\s]+$/g, ''))
      .filter(Boolean);
    let degree: string | null = null;
    let institution = '';
    for (const p of parts) {
      if (!institution && INSTITUTION_WORDS.test(p)) institution = p;
      else if (!degree && DEGREE_WORDS.test(p)) degree = p;
    }
    const leftovers = parts.filter((p) => p !== institution && p !== degree);
    if (!institution) institution = leftovers.shift() ?? '';
    if (!degree) degree = leftovers.shift() ?? null;
    if (!institution && degree) {
      institution = degree;
      degree = null;
    }
    if (institution) out.push({ degree, institution, startedOn, endedOn });
  };

  for (const text of lines) {
    const t = stripBullet(text);
    if (YEAR_RE.test(t)) {
      flush(t);
      continue;
    }
    pending.push(t);
    // Two dateless lines is a degree and a school; a third means the first
    // pair was an entry on its own, without a year.
    if (pending.length > 2) {
      const first = pending.splice(0, 2);
      const keep = pending;
      pending = first;
      flush(null);
      pending = keep;
    }
  }
  if (pending.length) flush(null);
  return out;
}

/**
 * Read a CV out of flat text. Never throws on content: a file with nothing
 * recognisable comes back empty, with warnings, and the caller decides.
 */
export function parseCvText(input: readonly ExtractedLine[]): ParsedCvFromText {
  const lines = tidy([...input]);
  const warnings: string[] = [];

  // Where each section starts. A heading hint from the file lets a title
  // that is not in the table ("Where I have worked") still close the
  // section before it.
  const sections: { kind: SectionKind; at: number }[] = [];
  lines.forEach((line, at) => {
    const kind = sectionKindOf(line);
    if (kind) sections.push({ kind, at });
    else if (line.heading && line.text.split(' ').length <= 5 && at > 0) {
      sections.push({ kind: 'other', at });
    }
  });
  const firstSection = sections[0]?.at ?? lines.length;
  const headerLines = lines.slice(0, firstSection).map((l) => l.text);
  const bodyOf = (kind: SectionKind): string[] => {
    const out: string[] = [];
    sections.forEach((s, i) => {
      if (s.kind !== kind) return;
      const end = sections[i + 1]?.at ?? lines.length;
      out.push(...lines.slice(s.at + 1, end).map((l) => l.text));
    });
    return out;
  };

  // The header: name, headline, summary, and the contact details, which may
  // also live in a section of their own in a two-column CV.
  const contactLines = [...headerLines, ...bodyOf('contact')];
  const nameLine = headerLines.find((t) => looksLikeName(t)) ?? headerLines[0] ?? '';
  const { first, last } = splitName(nameLine.replace(/[,.]+$/, ''));
  if (!nameLine) warnings.push('no name was found at the top');

  let headline: string | null = null;
  const summaryLines: string[] = [];
  let city: string | null = null;
  let region: string | null = null;
  const nameAt = headerLines.indexOf(nameLine);
  for (const t of headerLines.slice(nameAt + 1)) {
    // "Orlando, Florida · ada@lovelace.test · +1 407 555 0142": the place
    // shares its line with the contact details, so look before skipping.
    for (const seg of segmentsOf(t)) {
      const loc = locationIn(seg);
      if (loc && !city) {
        city = loc.city;
        region = loc.region;
      }
    }
    if (EMAIL_RE.test(t) || looksLikeUrl(t) || PHONE_LABEL.test(t) || PHONE_RE.test(t)) continue;
    if (segmentsOf(t).some((seg) => locationIn(seg))) continue;
    if (!headline && t.length <= 90 && !/[.!?]$/.test(t) && t.split(' ').length <= 12) {
      headline = t;
      continue;
    }
    if (t.split(' ').length >= 6) summaryLines.push(t);
    else if (summaryLines.length) break;
  }
  const summaryBody = bodyOf('summary');
  const summary = summaryBody.length
    ? summaryBody.join(' ')
    : summaryLines.length
      ? summaryLines.join(' ')
      : null;

  const contactText = contactLines.join('\n');
  const email = contactText.match(EMAIL_RE)?.[0].replace(/[.,)\]]+$/, '') ?? null;
  if (!email) warnings.push('no email address was found');
  let phone: string | null = null;
  for (const t of contactLines) {
    const labelled = PHONE_LABEL.test(t);
    const m = t.replace(PHONE_LABEL, ' ').match(PHONE_RE);
    if (!m) continue;
    const digits = m[0].replace(/\D/g, '');
    // Unlabelled, it has to look international or be long enough that it
    // cannot be a year, a postcode or a version.
    if (labelled || /^\+/.test(m[0].trim()) || digits.length >= 9) {
      phone = m[0].trim().replace(/[\s.-]+$/, '');
      break;
    }
  }
  if (!phone) warnings.push('no phone number was found');
  if (!city) {
    for (const t of bodyOf('contact')) {
      const loc = locationIn(t);
      if (loc) {
        city = loc.city;
        region = loc.region;
        break;
      }
    }
  }

  const links: ParsedLink[] = [];
  const seen = new Set<string>();
  for (const link of extractLinks(contactText)) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
  }

  let experienceLines = bodyOf('experience');
  if (experienceLines.length === 0 && sections.every((s) => s.kind !== 'experience')) {
    // No section said "Experience". Read the whole body for dated roles
    // rather than giving up, and say so.
    experienceLines = lines
      .slice(firstSection === lines.length ? nameAt + 1 : firstSection)
      .filter((l) => !sectionKindOf(l))
      .map((l) => l.text);
    warnings.push('no Experience section was found; roles were read from the whole document');
  }
  const work = parseExperience(experienceLines, warnings);
  const education = parseEducation(bodyOf('education'));
  if (education.length === 0) warnings.push('no education entries were found');

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
    warnings,
  };
}
