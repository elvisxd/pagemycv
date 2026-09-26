import { describe, expect, it } from 'vitest';
import { CHROMIUM_PATTERNS } from '../../src/fill/chromium-patterns.generated';
import type { FieldKind } from '../../src/fill/types';

// The generated module is only worth vendoring if it is actually usable, and
// "usable" means every pattern compiles in JavaScript. Chromium writes these
// as ICU regexes; the subset in use is compatible, lookbehind included, but a
// vendor bump could introduce one that is not. detect.ts skips a pattern that
// will not compile rather than throwing mid-fill, which would turn a broken
// pattern into a field that silently stops being recognised. This is the test
// that makes that silence loud.
describe('the vendored Chromium patterns', () => {
  const variants = [
    ...CHROMIUM_PATTERNS.positives.flatMap((p) => p.variants.map((v) => [p.type, v] as const)),
    ...CHROMIUM_PATTERNS.vetoes.flatMap((p) => p.variants.map((v) => [p.type, v] as const)),
  ];

  it('is not empty, which is what a failed generation would look like', () => {
    expect(CHROMIUM_PATTERNS.positives.length).toBeGreaterThanOrEqual(12);
    expect(variants.length).toBeGreaterThanOrEqual(20);
  });

  for (const [type, variant] of variants) {
    it(`${type}: the positive pattern compiles`, () => {
      expect(() => new RegExp(variant.positive, 'iu')).not.toThrow();
    });
    if (variant.negative) {
      it(`${type}: the negative pattern compiles`, () => {
        expect(() => new RegExp(variant.negative as string, 'iu')).not.toThrow();
      });
    }
  }

  it('maps every positive to a kind the fill path knows', () => {
    const kinds: FieldKind[] = [
      'given_name',
      'family_name',
      'full_name',
      'email',
      'phone',
      'address_line1',
      'address_line2',
      'city',
      'region',
      'postal_code',
      'country',
      'current_employer',
    ];
    for (const p of CHROMIUM_PATTERNS.positives) {
      expect(kinds, p.type).toContain(p.kind);
    }
  });

  it('scopes the IGNORED vetoes rather than applying them to everything', () => {
    // A global REGION_IGNORED would be `province|region|other`, which vetoes
    // the STATE field it exists to disambiguate. The generator leaves it out
    // entirely; the ones it keeps are scoped where Chromium scopes them.
    const named = CHROMIUM_PATTERNS.vetoes.map((v) => v.type);
    expect(named).not.toContain('REGION_IGNORED');
    for (const v of CHROMIUM_PATTERNS.vetoes) {
      if (v.type.endsWith('_IGNORED')) expect(v.scope, v.type).not.toBeNull();
    }
  });
});
