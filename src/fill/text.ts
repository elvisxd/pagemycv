// One normalisation, shared by every pass that matches text.
//
// It existed twice, subtly differently, and both copies were wrong in a way
// the other was not. The sensitive matcher lowercased before splitting
// camelCase, so `name="dateOfBirth"` never reached the date-of-birth pattern
// and a form that labels nothing would have had its birth date filled in.
// The label heuristics split first but kept the accents, so `Résumé` did not
// match `résumé` either: `\b` needs a word character on one side and `é` is
// not one, so the boundary after the final letter never held.
//
// Both are the same mistake — assuming the text arrives in the shape the
// pattern was written for — so there is now one function and one place to be
// wrong.

/**
 * Lowercased, accent-free, camelCase split into words, separators collapsed.
 *
 * The order is the part that matters. camelCase has to be split while the
 * capitals are still there, and the accents have to go before any pattern
 * relying on a word boundary sees them.
 */
export function normaliseText(raw: string): string {
  return (
    raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      // NFD splits an accented letter into its base plus a combining mark, and
      // the mark is then in a range we can drop. `é` becomes `e`, so a pattern
      // written in ASCII matches the word a French or Spanish page spells
      // properly.
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[_\-.[\]/(),]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
