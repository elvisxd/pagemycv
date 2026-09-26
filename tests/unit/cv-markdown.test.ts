import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCvMarkdown, parseDate, parseRange } from '../../src/import/cv-markdown';

const SAMPLE = `# Elvis R. Pino Bolívar

**Senior Full-Stack Engineer · AI Product Engineering**

10 years building full-stack software. Recent work: integrating large language
models and predictive systems into products running in production.

- Contacto: ver build/cv-en.html
- linkedin.com/in/elvis-pino-dev · github.com/elvisxd · my-porfolio-next.vercel.app
- Orlando, Florida · Open to relocation & remote work · Authorized to work in the US

## Experience

### Founder & Full-Stack Developer — Nesty C.A.
*2023 — Present · Remote · NestJS · Next.js*

- Founded and lead a technical consultancy focused on automation, web/mobile
  development and API integration.
- Design automation solutions using AI models.

### Internal Applications Developer — Walmart Inc.
*2022 — Present · Cocoa, FL · PHP · MySQL*

- Build and maintain internal web applications used by store staff.

### Software Engineer — IT Driver C.A.
*June 2017 — 2019 · Remote · PHP*

- Delivered internal tooling.

## Education

- **B.Sc. Systems Engineering** — Universidad de Margarita (Unimar), 2012–2017
- **Computer Science Diploma** — María Auxiliadora II, 2008–2012

## Certifications
`;

describe('parseDate', () => {
  it('reads a month and a year', () => {
    expect(parseDate('June 2023')).toBe('2023-06');
    expect(parseDate('Sept 2022')).toBe('2022-09');
  });
  it('reads a bare year', () => expect(parseDate('2019')).toBe('2019'));
  it('treats Present as open ended', () => {
    expect(parseDate('Present')).toBeNull();
    expect(parseDate('present')).toBeNull();
  });
});

describe('parseRange', () => {
  it('splits an em dash range', () =>
    expect(parseRange('2023 — Present')).toEqual({ startedOn: '2023', endedOn: null }));
  it('splits an en dash range with no spaces', () =>
    expect(parseRange('2012–2017')).toEqual({ startedOn: '2012', endedOn: '2017' }));
  it('handles months on both sides', () =>
    expect(parseRange('May 2019 — Aug 2020')).toEqual({
      startedOn: '2019-05',
      endedOn: '2020-08',
    }));
});

describe('parseCvMarkdown', () => {
  const cv = parseCvMarkdown(SAMPLE);

  it('splits the name', () => {
    expect(cv.legalFirst).toBe('Elvis');
    expect(cv.legalLast).toBe('R. Pino Bolívar');
  });

  it('reads the headline and summary', () => {
    expect(cv.headline).toContain('Senior Full-Stack Engineer');
    expect(cv.summary).toContain('10 years building full-stack software');
  });

  it('reads the location', () => {
    expect(cv.city).toBe('Orlando');
    expect(cv.region).toBe('Florida');
  });

  it('finds the links and classifies them', () => {
    const kinds = cv.links.map((l) => l.kind);
    expect(kinds).toContain('linkedin');
    expect(kinds).toContain('github');
  });

  it('reads every role', () => {
    expect(cv.work).toHaveLength(3);
    expect(cv.work[0]?.title).toBe('Founder & Full-Stack Developer');
    expect(cv.work[0]?.employer).toBe('Nesty C.A.');
  });

  it('marks a current role as open ended', () => {
    expect(cv.work[0]?.startedOn).toBe('2023');
    expect(cv.work[0]?.endedOn).toBeNull();
  });

  it('separates remote from a real location', () => {
    expect(cv.work[0]?.isRemote).toBe(true);
    expect(cv.work[0]?.location).toBeNull();
    expect(cv.work[1]?.isRemote).toBe(false);
    expect(cv.work[1]?.location).toBe('Cocoa, FL');
  });

  it('reads a month and year start date', () => {
    expect(cv.work[2]?.startedOn).toBe('2017-06');
    expect(cv.work[2]?.endedOn).toBe('2019');
  });

  it('joins wrapped bullet lines', () => {
    expect(cv.work[0]?.description).toContain('automation, web/mobile development and API');
  });

  it('reads education with its year range', () => {
    expect(cv.education).toHaveLength(2);
    expect(cv.education[0]?.degree).toBe('B.Sc. Systems Engineering');
    expect(cv.education[0]?.institution).toBe('Universidad de Margarita (Unimar)');
    expect(cv.education[0]?.startedOn).toBe('2012');
    expect(cv.education[0]?.endedOn).toBe('2017');
  });

  it('stops at the next section', () => {
    expect(cv.education.every((e) => !/Certification/i.test(e.institution))).toBe(true);
  });
});

// The real file, when it is available in this checkout.
describe('the real cv.md', () => {
  const path = '/home/user/byte/perfil/cv.md';
  let markdown: string | null = null;
  try {
    markdown = readFileSync(path, 'utf8');
  } catch {
    markdown = null;
  }
  it.skipIf(markdown === null)('parses every role and every degree', () => {
    const cv = parseCvMarkdown(markdown as string);
    expect(cv.legalFirst).toBeTruthy();
    expect(cv.work.length).toBeGreaterThanOrEqual(5);
    expect(cv.work.every((w) => w.title && w.employer)).toBe(true);
    expect(cv.education.length).toBeGreaterThanOrEqual(1);
  });
});

// Each of these was a real defect found in review. They are grouped because
// they share a cause: a heuristic that was right for one shape of CV and
// silently wrong for another, with no error and no visible symptom.
describe('shapes of CV that used to parse wrong', () => {
  it('keeps the employer when the title contains a dash', () => {
    const cv = parseCvMarkdown(
      '# A B\n\n## Experience\n\n### Senior Engineer — Payments — Stripe\n*2020 — 2022 · Remote*\n\n- did things\n',
    );
    expect(cv.work[0]?.employer).toBe('Stripe');
    expect(cv.work[0]?.title).toBe('Senior Engineer — Payments');
  });

  it('still reads the ordinary two part heading', () => {
    const cv = parseCvMarkdown(
      '# A B\n\n## Experience\n\n### Full-Stack Developer — Freelance\n*2022 — Present · Remote*\n',
    );
    expect(cv.work[0]?.title).toBe('Full-Stack Developer');
    expect(cv.work[0]?.employer).toBe('Freelance');
  });

  it('reads a year range written with a plain hyphen', () => {
    expect(parseRange('2012-2017')).toEqual({ startedOn: '2012', endedOn: '2017' });
    expect(parseRange('2012 - 2017')).toEqual({ startedOn: '2012', endedOn: '2017' });
    expect(parseRange('2012–2017')).toEqual({ startedOn: '2012', endedOn: '2017' });
  });

  it('does not mistake a bold headline for a location', () => {
    const cv = parseCvMarkdown('# A B\n\n**Senior Engineer, Remote**\n\n## Experience\n');
    expect(cv.city).toBeNull();
    expect(cv.region).toBeNull();
  });

  it('still reads the location from a bullet', () => {
    const cv = parseCvMarkdown(
      '# A B\n\n- Orlando, Florida · Open to relocation & remote work\n\n## Experience\n',
    );
    expect(cv.city).toBe('Orlando');
    expect(cv.region).toBe('Florida');
  });

  it('finds the headline when the document starts with front matter', () => {
    const front = `---\ntitle: cv\nauthor: someone\n---\n\n<!-- generated -->\n\n${'\n'.repeat(14)}`;
    const cv = parseCvMarkdown(`${front}# A B\n\n**Senior Engineer**\n\nMy summary.\n`);
    expect(cv.headline).toBe('Senior Engineer');
    expect(cv.summary).toBe('My summary.');
  });

  it('does not turn prose into links', () => {
    const cv = parseCvMarkdown(
      '# A B\n\n- Shipped v2.1/beta and moved to Node.js/22 runtime\n- github.com/someone\n\n## Experience\n',
    );
    const urls = cv.links.map((l) => l.url);
    expect(urls).toContain('https://github.com/someone');
    expect(urls.some((u) => u.includes('v2.1'))).toBe(false);
  });
});
