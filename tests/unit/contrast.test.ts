import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// docs/07-design.md promises "4.5:1 on all text, asserted in CI, not assumed
// from the palette". This is that assertion. It did not exist, and when it was
// finally written two of the five state colours were failing.
//
// The values come from the Radix stylesheets actually installed, so a version
// bump that shifts a scale fails here rather than in someone's eyes.

const BASE = 'node_modules/@radix-ui/colors';

function scale(name: string): Record<number, string> {
  const css = readFileSync(`${BASE}/${name}.css`, 'utf8');
  const out: Record<number, string> = {};
  for (const m of css.matchAll(/--\w+?-(\d+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[Number(m[1])] = m[2] as string;
  }
  return out;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return (
    0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = ['light', 'dark'] as const;
const suffix = (t: (typeof THEMES)[number]) => (t === 'dark' ? '-dark' : '');

const STATES = ['blue', 'orange', 'plum', 'gray', 'red'] as const;

describe('contrast, WCAG 2.2 AA', () => {
  it('sanity check: the formula matches known values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const gray = scale(`gray${suffix(theme)}`);

      it('body text clears 4.5:1', () => {
        expect(contrast(gray[12] as string, gray[1] as string)).toBeGreaterThanOrEqual(4.5);
      });

      it('muted text clears 4.5:1', () => {
        expect(contrast(gray[11] as string, gray[1] as string)).toBeGreaterThanOrEqual(4.5);
      });

      // WCAG 1.4.11: anything needed to identify a control. This border is the
      // only boundary of the passphrase field and of every quiet button.
      it('the control border clears 3:1', () => {
        expect(contrast(gray[9] as string, gray[1] as string)).toBeGreaterThanOrEqual(3);
      });

      for (const name of STATES) {
        it(`the ${name} chip label clears 4.5:1`, () => {
          const s = scale(`${name}${suffix(theme)}`);
          expect(contrast(s[12] as string, s[2] as string)).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }

  // The reason the tokens are what they are. If a future change moves the chip
  // label back to step 11, this records why that fails.
  it('records that step 11 was not good enough for every hue', () => {
    const blue = scale('blue');
    const orange = scale('orange');
    expect(contrast(blue[11] as string, blue[3] as string)).toBeLessThan(4.5);
    expect(contrast(orange[11] as string, orange[3] as string)).toBeLessThan(4.5);
  });
});
