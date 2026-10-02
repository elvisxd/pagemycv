// The heuristic reader, against the text the two extractors actually produce.
//
// The one-column and two-column inputs below are the lines pdf.js returned
// for spikes/cv-file/cv/*.html, copied rather than regenerated: a test that
// re-ran the extractor would be testing pdf.js, and this file tests the
// reading. The gate runs the whole path against the real files.
import { describe, expect, it } from 'vitest';
import { parseCvText } from '../../src/import/cv-text';
import type { ExtractedLine } from '../../src/import/text';

const lines = (text: string, headings: string[] = []): ExtractedLine[] =>
  text
    .split('\n')
    .map((t) => (headings.includes(t.trim()) ? { text: t, heading: true } : { text: t }));

/** What pdf.js produced for cv/one-col.html, one column, English. */
const ONE_COLUMN = `Ada M. Lovelace
Senior Full-Stack Engineer · Applied AI
Twelve years building software that runs in production, most recently putting language models behind
deterministic code rather than in front of it.
Orlando, Florida · ada@lovelace.test · +1 407 555 0142
linkedin.com/in/ada-lovelace · github.com/adalovelace · adalovelace.dev/work
Experience
Founder & Full-Stack Developer, Nesty C.A. — Remote
2023 – Present
Founded a consultancy focused on automation and API integration.
Designed automation using a microservices architecture.
Internal Applications Developer, Analytical Engine Co. — Cocoa, FL
2022 – Present
Built internal web applications used daily by operations staff.
Backend Developer, Difference Engine Ltd. — Remote
May 2019 – Aug 2020
Built and maintained billing services.
Education
B.Sc. Systems Engineering — Universidad de Margarita (Unimar), 2012–2017
Computer Science Diploma — María Auxiliadora II, 2008–2012
Skills
TypeScript, NestJS, React, PostgreSQL, Python`;

/** What pdf.js produced for cv/two-col.html after the gutter split: left column, then right. */
const TWO_COLUMN_SPANISH = `Elvis Rey
Desarrollador Full-Stack
Contacto
Caracas, Venezuela
elvis@example.test
Teléfono: +58 412 555 0199
linkedin.com/in/elvisrey
github.com/elvisxd
Habilidades
TypeScript · React · Node · SQL
Idiomas
Español nativo, Inglés B2
Perfil
Ingeniero con ocho años construyendo aplicaciones web para
operaciones y finanzas.
Experiencia
Desarrollador Senior — Nesty C.A., Remoto
Marzo 2023 – Actualidad
Automatización de procesos con microservicios.
Desarrollador Backend — Banco Ficticio, Caracas
2019 – 2023
Servicios de pagos en Node y PostgreSQL.
Educación
Ingeniería de Sistemas — Universidad de Margarita, 2012 – 2017`;

describe('a one-column English CV, as pdf.js reads it', () => {
  const cv = parseCvText(lines(ONE_COLUMN));

  it('finds the name, the headline and the summary at the top', () => {
    expect(cv.legalFirst).toBe('Ada');
    expect(cv.legalLast).toBe('M. Lovelace');
    expect(cv.headline).toBe('Senior Full-Stack Engineer · Applied AI');
    expect(cv.summary).toMatch(/^Twelve years building/);
    expect(cv.summary).toMatch(/in front of it\.$/);
  });

  it('finds the contact details on a line that mixes them with a dot separator', () => {
    expect(cv.email).toBe('ada@lovelace.test');
    expect(cv.phone).toBe('+1 407 555 0142');
    expect(cv.city).toBe('Orlando');
    expect(cv.region).toBe('Florida');
    expect(cv.links.map((l) => l.url)).toEqual([
      'https://linkedin.com/in/ada-lovelace',
      'https://github.com/adalovelace',
      'https://adalovelace.dev/work',
    ]);
  });

  it('splits "Title, Employer — Place" headings whose dates come on the next line', () => {
    expect(cv.work).toHaveLength(3);
    expect(cv.work[0]).toMatchObject({
      title: 'Founder & Full-Stack Developer',
      employer: 'Nesty C.A.',
      isRemote: true,
      location: null,
      startedOn: '2023',
      endedOn: null,
    });
    expect(cv.work[0]?.description).toBe(
      'Founded a consultancy focused on automation and API integration.\nDesigned automation using a microservices architecture.',
    );
    expect(cv.work[1]).toMatchObject({
      title: 'Internal Applications Developer',
      employer: 'Analytical Engine Co.',
      location: 'Cocoa, FL',
      isRemote: false,
    });
    expect(cv.work[2]).toMatchObject({ startedOn: '2019-05', endedOn: '2020-08', isRemote: true });
  });

  it('reads education as degree, institution and years', () => {
    expect(cv.education).toEqual([
      {
        degree: 'B.Sc. Systems Engineering',
        institution: 'Universidad de Margarita (Unimar)',
        startedOn: '2012',
        endedOn: '2017',
      },
      {
        degree: 'Computer Science Diploma',
        institution: 'María Auxiliadora II',
        startedOn: '2008',
        endedOn: '2012',
      },
    ]);
  });

  it('has nothing to warn about', () => {
    expect(cv.warnings).toEqual([]);
  });
});

describe('a two-column Spanish CV, columns already untangled', () => {
  const cv = parseCvText(lines(TWO_COLUMN_SPANISH));

  it('reads Spanish section titles and a labelled phone in a Contacto section', () => {
    expect(cv.legalFirst).toBe('Elvis');
    expect(cv.legalLast).toBe('Rey');
    expect(cv.headline).toBe('Desarrollador Full-Stack');
    expect(cv.email).toBe('elvis@example.test');
    expect(cv.phone).toBe('+58 412 555 0199');
    expect(cv.city).toBe('Caracas');
    expect(cv.region).toBe('Venezuela');
  });

  it('takes the summary from the Perfil section', () => {
    expect(cv.summary).toBe(
      'Ingeniero con ocho años construyendo aplicaciones web para operaciones y finanzas.',
    );
  });

  it('reads "Marzo 2023 – Actualidad" as a current role and Remoto as remote', () => {
    expect(cv.work).toHaveLength(2);
    expect(cv.work[0]).toMatchObject({
      title: 'Desarrollador Senior',
      employer: 'Nesty C.A.',
      isRemote: true,
      startedOn: '2023-03',
      endedOn: null,
      description: 'Automatización de procesos con microservicios.',
    });
    expect(cv.work[1]).toMatchObject({
      title: 'Desarrollador Backend',
      employer: 'Banco Ficticio',
      location: 'Caracas',
      startedOn: '2019',
      endedOn: '2023',
    });
  });

  it('reads Educación', () => {
    expect(cv.education).toEqual([
      {
        degree: 'Ingeniería de Sistemas',
        institution: 'Universidad de Margarita',
        startedOn: '2012',
        endedOn: '2017',
      },
    ]);
  });

  it('does not mistake the skills list for anything', () => {
    expect(cv.work.map((w) => w.title)).not.toContain('TypeScript');
    expect(cv.warnings).toEqual([]);
  });
});

describe('the other shapes a CV takes', () => {
  it('dates first, then the title, as many templates print them', () => {
    const cv = parseCvText(
      lines(`Grace Hopper
Experience
Jun 2020 – Present
Senior Compiler Engineer at Eckert-Mauchly
Wrote the first compiler.
2015 – 2020
Mathematician — Harvard University, Cambridge, MA
Education
Yale University — Ph.D. Mathematics, 1934`),
    );
    expect(cv.work).toHaveLength(2);
    expect(cv.work[0]).toMatchObject({
      title: 'Senior Compiler Engineer',
      employer: 'Eckert-Mauchly',
      startedOn: '2020-06',
      endedOn: null,
      description: 'Wrote the first compiler.',
    });
    expect(cv.work[1]).toMatchObject({
      title: 'Mathematician',
      employer: 'Harvard University',
      location: 'Cambridge, MA',
      startedOn: '2015',
      endedOn: '2020',
    });
    expect(cv.education[0]).toMatchObject({
      institution: 'Yale University',
      degree: 'Ph.D. Mathematics',
      endedOn: '1934',
    });
  });

  it('title and employer on two lines, then the dates', () => {
    const cv = parseCvText(
      lines(`Linus T.
Work Experience
Principal Engineer
Linux Foundation
2005 – Present
Keeps the tree merging.`),
    );
    expect(cv.work).toEqual([
      expect.objectContaining({
        title: 'Principal Engineer',
        employer: 'Linux Foundation',
        startedOn: '2005',
        endedOn: null,
        description: 'Keeps the tree merging.',
      }),
    ]);
  });

  it('employer before title, told apart by the words', () => {
    const cv = parseCvText(
      lines(`Ada Byron
Experience
Analytical Engine Co. — Software Engineer
2019 – 2021`),
    );
    expect(cv.work[0]).toMatchObject({
      title: 'Software Engineer',
      employer: 'Analytical Engine Co.',
    });
  });

  it('uses a Word heading style to close a section whose title it does not know', () => {
    const cv = parseCvText(
      lines(
        `Ada Byron
Experience
Engineer — Acme
2019 – 2021
Where I have spoken
2020 – PyCon keynote`,
        ['Where I have spoken'],
      ),
    );
    // Without the heading hint, "2020 – PyCon keynote" would read as a role.
    expect(cv.work).toHaveLength(1);
  });

  it('reads dated roles from a CV with no section titles at all, and says so', () => {
    const cv = parseCvText(
      lines(`Ada Byron
ada@byron.test
Engineer — Acme
2019 – 2021
Built things.`),
    );
    expect(cv.work).toHaveLength(1);
    expect(cv.warnings).toContain(
      'no Experience section was found; roles were read from the whole document',
    );
  });

  it('a phone with no label and no plus is still a phone when it is long enough', () => {
    const cv = parseCvText(lines('Ada Byron\n(407) 555-0142\nada@byron.test\nExperience'));
    expect(cv.phone).toBe('(407) 555-0142');
  });

  it('a year alone is never a phone, and a sentence is never a name', () => {
    const cv = parseCvText(
      lines(`Dear Hiring Manager,
I am writing to apply for the role advertised in 2024.
Regards`),
    );
    expect(cv.phone).toBeNull();
    expect(cv.work).toEqual([]);
    expect(cv.education).toEqual([]);
    // No name-shaped line, so the first line is taken and the warnings say
    // what else is missing; the caller refuses an import with no roles.
    expect(cv.warnings).toEqual(
      expect.arrayContaining(['no email address was found', 'no education entries were found']),
    );
  });

  it('a headline is never a location and a location is never a headline', () => {
    const cv = parseCvText(lines('Ada Byron\nLondon, England\nSenior Engineer\nExperience'));
    expect(cv.city).toBe('London');
    expect(cv.headline).toBe('Senior Engineer');
  });

  it('wrapped bullets are joined back together', () => {
    const cv = parseCvText(
      lines(`Ada Byron
Experience
Engineer — Acme
2019 – 2021
• Led a team that shipped a payments platform to
production in nine months.
• Mentored four engineers.`),
    );
    expect(cv.work[0]?.description).toBe(
      'Led a team that shipped a payments platform to production in nine months.\nMentored four engineers.',
    );
  });
});
