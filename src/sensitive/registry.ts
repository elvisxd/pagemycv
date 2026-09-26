// The sensitive field class. These NEVER fill automatically. Each one surfaces
// alone, with its reason shown before its value, and skipping is the default.
//
// The rule comes from the user's own private profile notes in Byte, about work
// authorization expiry: "Si un formulario lo pide como campo obligatorio, eso
// es una decisión que la toma él: preguntale antes de completar nada."
import type { SensitiveCategory } from '../db/schema';

export interface SensitiveDefinition {
  key: string;
  category: SensitiveCategory;
  label: string;
  reason: string;
  /** Padded before encryption: few possible values, so length leaks the value. */
  padded: boolean;
}

export const SENSITIVE_FIELDS: readonly SensitiveDefinition[] = [
  {
    key: 'work_authorization_status',
    category: 'authorization',
    label: 'Work authorization status',
    reason:
      'Saying you are authorized is routine. Saying which status you hold is not. Decide per employer.',
    padded: true,
  },
  {
    key: 'work_authorization_expiry',
    category: 'authorization',
    label: 'Work authorization expiry',
    reason:
      'A valid authorization and a visible expiry date read very differently. The second is a clock running. When and whether to say it is your call.',
    padded: true,
  },
  {
    key: 'requires_sponsorship',
    category: 'authorization',
    label: 'Requires visa sponsorship',
    reason: 'Often the first filter applied. Answer it deliberately, not by autofill.',
    padded: true,
  },
  {
    key: 'citizenship',
    category: 'authorization',
    label: 'Country of citizenship',
    reason: 'Rarely needed before an offer, and it identifies you.',
    padded: true,
  },
  {
    key: 'ssn',
    category: 'government_id',
    label: 'Social security number',
    reason:
      'Almost never legitimately required to apply. A form asking for it before an offer is worth a second look.',
    padded: true,
  },
  {
    key: 'national_id',
    category: 'government_id',
    label: 'National identity number',
    reason: 'Identity theft material. Give it only when you know why it is needed.',
    padded: true,
  },
  {
    key: 'salary_current',
    category: 'compensation',
    label: 'Current salary',
    reason: 'Illegal to ask in several states. Answering anchors every later number against you.',
    padded: true,
  },
  {
    key: 'salary_expected',
    category: 'compensation',
    label: 'Expected salary',
    reason: 'The first number spoken usually wins. Think before it is typed for you.',
    padded: true,
  },
  {
    key: 'gender',
    category: 'demographics',
    label: 'Gender',
    reason:
      'Voluntary, and declining is a protected choice. An autofill would make that choice once, for every application.',
    padded: true,
  },
  {
    key: 'race_ethnicity',
    category: 'demographics',
    label: 'Race and ethnicity',
    reason: 'Voluntary. Same reasoning as gender.',
    padded: true,
  },
  {
    key: 'veteran_status',
    category: 'demographics',
    label: 'Veteran status',
    reason: 'Voluntary. Same reasoning as gender.',
    padded: true,
  },
  {
    key: 'disability_status',
    category: 'demographics',
    label: 'Disability status',
    reason: 'Voluntary. Same reasoning as gender.',
    padded: true,
  },
  {
    key: 'date_of_birth',
    category: 'birth',
    label: 'Date of birth',
    reason: 'Age discrimination is hard to prove and easy to do. Rarely needed to apply.',
    padded: true,
  },
  {
    key: 'criminal_record',
    category: 'background',
    label: 'Criminal record',
    reason:
      'Ban-the-box laws restrict when this may be asked at all. Answer it yourself, every time.',
    padded: true,
  },
];

const BY_KEY = new Map(SENSITIVE_FIELDS.map((f) => [f.key, f]));

export function sensitiveByKey(key: string): SensitiveDefinition | undefined {
  return BY_KEY.get(key);
}

/** True when a column must never be written by an automatic pass. */
export function isSensitiveKey(key: string): boolean {
  return BY_KEY.has(key);
}
