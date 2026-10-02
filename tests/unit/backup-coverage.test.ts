import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKED_UP_TABLES, NOT_BACKED_UP } from '../../src/backup/format';

// A backup that silently forgets a table is worse than no backup: it restores
// "successfully" and the loss is found weeks later. Nothing about adding a
// table to a migration would remind anybody to add it to the backup, so this
// file is the reminder. It reads the schema and the worker as text, the way
// scripts/guard.mjs does, because the question is about what the code SAYS.

const ROOT = join(__dirname, '../..');
const MIGRATIONS = join(ROOT, 'src/db/migrations');
const schema = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');
const worker = readFileSync(join(ROOT, 'src/db/worker.ts'), 'utf8');

const tablesInSchema = [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1] as string);
const tablesWritten = new Set(
  [...worker.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/g)].map((m) => m[1] as string),
);

describe('the backup covers the schema', () => {
  it('found the schema at all', () => {
    // Without this, an empty match list would make every test below pass.
    expect(tablesInSchema.length).toBeGreaterThan(10);
    expect(tablesWritten.size).toBeGreaterThan(5);
  });

  it('has a decision for every table: backed up, or excluded with a reason', () => {
    const decided = new Set<string>([...BACKED_UP_TABLES, ...Object.keys(NOT_BACKED_UP)]);
    const undecided = tablesInSchema.filter((t) => !decided.has(t));
    expect(
      undecided,
      'add these to BACKED_UP_TABLES or NOT_BACKED_UP in src/backup/format.ts',
    ).toEqual([]);
  });

  it('never lists a table in both', () => {
    const both = BACKED_UP_TABLES.filter((t) => t in NOT_BACKED_UP);
    expect(both).toEqual([]);
  });

  it('only excludes "nothing writes it yet" tables that nothing writes', () => {
    // The day the worker starts writing one of these, its exclusion reason
    // stops being true, and the backup is quietly losing data.
    const claimedUnwritten = Object.entries(NOT_BACKED_UP)
      .filter(
        ([, reason]) =>
          reason === 'nothing writes it yet.' || reason.startsWith('nothing writes it yet.'),
      )
      .map(([table]) => table);
    const nowWritten = claimedUnwritten.filter((t) => tablesWritten.has(t));
    expect(nowWritten, 'these are written now: back them up, or change why they are not').toEqual(
      [],
    );
  });
});

describe('the backup has no passphrase, which holds only while sensitive values cannot be stored', () => {
  it('nothing updates a sensitive value', () => {
    expect(
      /UPDATE\s+sensitive_value/.test(worker),
      'sensitive values became settable. The backup file is NOT encrypted, so it must not carry ' +
        'them as it is: redesign the backup (a passphrase on the file, or a separate encrypted ' +
        'section) BEFORE adding sensitive_value to BACKED_UP_TABLES. See DECISIONS.md.',
    ).toBe(false);
  });

  it('the only insert seeds them empty', () => {
    const inserts = [...worker.matchAll(/INSERT INTO sensitive_value[^`]*`/g)].map((m) => m[0]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/value_enc/);
    // value_enc is the fifth column and is bound to a literal NULL.
    expect(inserts[0]).toMatch(/VALUES \(\?, \?, \?, \?, NULL,/);
  });
});
