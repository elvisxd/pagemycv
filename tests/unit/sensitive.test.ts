import { describe, expect, it } from 'vitest';
import { isSensitiveKey, SENSITIVE_FIELDS, sensitiveByKey } from '../../src/sensitive/registry';

// The registry is the list of things this product refuses to type for you.
// A field missing from it is a field that would fill automatically, so the
// shape of this list is worth testing even though it is only data.
describe('the sensitive field registry', () => {
  it('covers every category named in docs/03-security.md', () => {
    const categories = new Set(SENSITIVE_FIELDS.map((f) => f.category));
    expect([...categories].sort()).toEqual([
      'authorization',
      'background',
      'birth',
      'compensation',
      'demographics',
      'government_id',
    ]);
  });

  it('has no duplicate keys, because a duplicate would silently shadow one', () => {
    const keys = SENSITIVE_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every field a reason, shown before the value is ever offered', () => {
    for (const f of SENSITIVE_FIELDS) {
      expect(f.reason.length, `${f.key} has no reason`).toBeGreaterThan(20);
      expect(f.label.length, `${f.key} has no label`).toBeGreaterThan(2);
    }
  });

  it('pads every field, because for these the ciphertext length is the value', () => {
    expect(SENSITIVE_FIELDS.every((f) => f.padded)).toBe(true);
  });

  it('includes the four voluntary demographic questions', () => {
    const demographic = SENSITIVE_FIELDS.filter((f) => f.category === 'demographics').map(
      (f) => f.key,
    );
    expect(demographic.sort()).toEqual([
      'disability_status',
      'gender',
      'race_ethnicity',
      'veteran_status',
    ]);
  });

  it('includes work authorization expiry, which is where the rule came from', () => {
    const field = sensitiveByKey('work_authorization_expiry');
    expect(field).toBeDefined();
    expect(field?.reason).toMatch(/clock/i);
  });

  it('recognises a key that is in the class', () => {
    expect(isSensitiveKey('ssn')).toBe(true);
    expect(isSensitiveKey('salary_expected')).toBe(true);
  });

  it('does not claim an ordinary field is sensitive', () => {
    expect(isSensitiveKey('email')).toBe(false);
    expect(isSensitiveKey('first_name')).toBe(false);
  });

  it('returns nothing for a key it does not know', () => {
    expect(sensitiveByKey('not_a_field')).toBeUndefined();
  });
});
