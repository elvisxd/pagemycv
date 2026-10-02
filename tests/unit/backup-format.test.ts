import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type Backup,
  BackupError,
  parseBackup,
  serializeBackup,
} from '../../src/backup/format';

function sample(): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-09-28T12:00:00.000Z',
    profile: {
      legalFirst: 'Ada',
      legalLast: 'Lovelace',
      preferredName: null,
      headline: 'Analyst',
      summary: null,
      locale: 'en-US',
    },
    contact: {
      email: 'ada@example.com',
      phone: '+1 555 0100',
      addressLine1: null,
      addressLine2: null,
      city: 'Orlando',
      region: 'Florida',
      postalCode: null,
      country: 'US',
    },
    work: [
      {
        employer: 'Analytical Engines',
        title: 'Engineer',
        location: null,
        isRemote: true,
        startedOn: '2020-01',
        endedOn: null,
        description: 'Notes on the engine.',
      },
    ],
    education: [{ institution: 'Home', degree: null, field: null, startedOn: null, endedOn: null }],
    links: [{ kind: 'github', url: 'https://github.com/ada' }],
    resume: { filename: 'cv.pdf', mimeType: 'application/pdf', base64: btoa('%PDF-1.7 fake') },
    screeningAnswers: { notice_period: 'Two weeks', relocation_ok: 'No' },
  };
}

/** Parse something built from the sample with one thing changed. */
const withChange = (change: (b: Record<string, unknown>) => void) => {
  const b = JSON.parse(serializeBackup(sample()));
  change(b);
  return () => parseBackup(JSON.stringify(b));
};

describe('a backup file', () => {
  it('comes back exactly as it went out', () => {
    expect(parseBackup(serializeBackup(sample()))).toEqual(sample());
  });

  it('keeps the order of roles, which is the order they are shown in', () => {
    const b = sample();
    b.work.push({ ...b.work[0], employer: 'Second' } as Backup['work'][number]);
    expect(parseBackup(serializeBackup(b)).work.map((w) => w.employer)).toEqual([
      'Analytical Engines',
      'Second',
    ]);
  });

  it('is refused when it is not JSON at all', () => {
    expect(() => parseBackup('%PDF-1.7')).toThrow(BackupError);
    expect(() => parseBackup('%PDF-1.7')).toThrow(/not readable JSON/);
  });

  it('is refused when it is JSON but not ours', () => {
    expect(() => parseBackup('{"name":"package.json"}')).toThrow(/not a PageMyCV backup/);
  });

  it('says so plainly when it comes from a newer PageMyCV', () => {
    // Not "damaged": the file is fine, this build is old. The fix is an
    // update, and a message that says "damaged" sends people to the wrong one.
    expect(withChange((b) => (b.version = BACKUP_VERSION + 1))).toThrow(/newer PageMyCV/);
  });

  it('is refused when a field has the wrong type, naming the field', () => {
    const firstRole = (b: Record<string, unknown>) =>
      (b.work as Record<string, unknown>[])[0] ?? {};
    expect(withChange((b) => (firstRole(b).isRemote = 'yes'))).toThrow(/work\[0\]\.isRemote/);
    expect(withChange((b) => delete firstRole(b).employer)).toThrow(/work\[0\]\.employer/);
  });

  it('refuses an answer to a question this build does not know', () => {
    expect(
      withChange((b) => ((b.screeningAnswers as Record<string, string>).favourite_colour = 'blue')),
    ).toThrow(/favourite_colour/);
  });

  it('refuses a résumé that cannot be decoded, instead of failing on a real form later', () => {
    expect(
      withChange((b) => ((b.resume as Record<string, string>).base64 = '%%% not base64')),
    ).toThrow(/résumé .* damaged/);
  });

  it('refuses an empty backup, because a restore replaces what is there', () => {
    expect(
      withChange((b) => {
        b.profile = null;
        b.work = [];
        b.education = [];
        b.resume = null;
      }),
    ).toThrow(/empty/);
  });

  it('accepts a backup with no résumé and no contact', () => {
    const b = sample();
    b.resume = null;
    b.contact = null;
    expect(parseBackup(serializeBackup(b))).toEqual(b);
  });

  it('does not carry anything it was not built to carry', () => {
    // A field smuggled into the file must not reach the vault. parseBackup
    // builds its result field by field, so extras are dropped, never passed.
    const parsed = withChange((b) => {
      b.sensitive = { ssn: '000-00-0000' };
      (b.profile as Record<string, unknown>).isAdmin = true;
    })();
    expect(parsed).not.toHaveProperty('sensitive');
    expect(parsed.profile).not.toHaveProperty('isAdmin');
  });
});
