// The vocabulary the fill path speaks. Nothing here touches the DOM or the
// vault: the classifier, the planner and their tests all work on these plain
// records, which is what makes the interesting logic testable without a
// browser.

/** How to drive one family of custom listbox. All four are required. */
export interface ListboxSelectors {
  /** The wrapper that carries the field's identity. */
  container: string;
  /** What to dispatch a click at to open the menu. */
  trigger: string;
  /** The options, queried AFTER the trigger, in the same task. */
  option: string;
  /** Where the chosen text ends up, for the read-back that proves it landed. */
  display: string;
}

export interface ListboxDescriptor {
  ref: string;
  /** `data-automation-id` on the container, which is the ATS's own contract. */
  automationId: string;
  label: string;
  /** What it already reads, so an answered question is left alone. */
  current: string;
}

export type ListboxAction =
  | { action: 'select'; ref: string; label: string; kind: FieldKind; value: string }
  | { action: 'skip'; ref: string; label: string; reason: ListboxSkip };

export type ListboxSkip = 'unrecognised' | 'no-value' | 'already-filled' | 'unsupported';

/** What we can recognise on a form. Sensitive keys are the registry's, not these. */
export type FieldKind =
  | 'given_name'
  | 'family_name'
  | 'full_name'
  | 'preferred_name'
  | 'email'
  | 'phone'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'region'
  | 'postal_code'
  | 'country'
  | 'current_employer'
  | 'current_title'
  | 'linkedin_url'
  | 'github_url'
  | 'portfolio_url'
  | 'other_url'
  | 'resume_file'
  | 'cover_letter'
  | 'education_school'
  | 'education_degree'
  | 'education_field'
  | 'notice_period'
  | 'how_did_you_hear'
  // A single box for the whole place, which Ashby uses where Lever and
  // Greenhouse ask for city and region separately.
  | 'location'
  // The screening questions. Nothing in a CV answers these; they are filled
  // only from an answer you typed yourself. See SCREENING_KINDS.
  | 'travel_ok'
  | 'relocation_ok'
  | 'security_clearance';

/**
 * Kinds whose value can ONLY come from an answer you gave, never from the CV
 * and never from inference.
 *
 * `plan.ts` used to refuse `notice_period` and `how_did_you_hear` outright,
 * with the note "we hold no answer for these, and a plausible guess is the
 * failure mode this whole design exists to avoid". That was right while
 * there was nowhere to put an answer. There is now, and the rule that
 * replaces it keeps the same guarantee: these fill from the screening table
 * or they do not fill at all.
 */
export const SCREENING_KINDS: readonly FieldKind[] = [
  // Yes, an identity field, and it belongs here for the same reason as the
  // rest: no CV holds it and it must never be inferred. Defaulting a
  // preferred name to the legal first name would be wrong precisely for the
  // people the field exists to serve — someone who goes by a different name
  // would have their legal one typed into the box that asks them not to.
  'preferred_name',
  'notice_period',
  'how_did_you_hear',
  'travel_ok',
  'relocation_ok',
  'security_clearance',
  // The cover letter box. It used to be refused outright — "writing a
  // generic cover letter on the user's behalf is worse than leaving it
  // empty" — and that stays true of a GENERATED one. One the person wrote
  // and stored is theirs, and the same rule as every kind above applies: it
  // fills from what they typed or it does not fill at all. A file input
  // asking for a cover letter is a different thing and attaches the stored
  // file instead; see plan.ts.
  'cover_letter',
];

export function isScreeningKind(kind: FieldKind): boolean {
  return (SCREENING_KINDS as readonly string[]).includes(kind);
}

/** Which of the four passes resolved a field. Recorded, shown, and stored. */
export type MatchStrategy = 'autocomplete' | 'chromium' | 'ats' | 'label' | 'sensitive';

/**
 * A form control, flattened. Built by `describe()` in descriptor.ts, which is
 * the only module that reads the DOM, so everything downstream is pure.
 */
export interface FieldDescriptor {
  /** Stable within one page pass. Used to correlate a plan back to an element. */
  ref: string;
  /**
   * What this control looked like when it was described: tag, type, name, id.
   *
   * The plan carries it and the writer re-derives it from the live element
   * before touching anything. A page can re-render between the two messages,
   * and React reuses DOM nodes while changing their attributes, so a held
   * reference can quietly become a different field. Without this, the right
   * value would be written into the wrong box and reported as a success.
   */
  fingerprint: string;
  tag: 'input' | 'select' | 'textarea';
  /** Lowercased `type` for inputs; 'select-one' / 'select-multiple' for selects. */
  type: string;
  name: string;
  id: string;
  /** The `autocomplete` attribute, lowercased and trimmed. */
  autocomplete: string;
  /** Resolved label text: <label for>, wrapping <label>, aria-label, placeholder. */
  label: string;
  placeholder: string;
  ariaLabel: string;
  /** ATS-specific hook. Workday's is the one that matters; kept general. */
  automationId: string;
  required: boolean;
  /** True when the control already holds a value a person may have typed. */
  hasValue: boolean;
  /** Disabled here or by an ancestor <fieldset disabled>. */
  disabled: boolean;
  readOnly: boolean;
  /** Options for a select, in document order. Value and visible text. */
  options: readonly { value: string; text: string }[];
  /** Layout facts, already computed. See visibility.ts for what they mean. */
  metrics: VisibilityMetrics;
  /**
   * For a file input only: the layout facts of the thing a person clicks to
   * open the picker, when the input itself is not that thing.
   *
   * Every board styles its own upload control and parks the real
   * `<input type="file">` at 1x1 under a clip, because a native file input
   * cannot be styled. Measured on its own, the input fails the visibility
   * gate and the résumé is never attached; measured by its label or its
   * dropzone, it is as visible as what the person sees. Null for every other
   * control, and null for a file input with no label and no dropzone, which
   * then stands or falls on its own box like anything else.
   */
  trigger: VisibilityMetrics | null;
}

/**
 * Everything the visibility gate needs, read once. Separated from the element
 * so the rule is a pure function: the rule is the part worth testing, and a
 * rule that needs a browser to test is a rule nobody tests.
 */
export interface VisibilityMetrics {
  width: number;
  height: number;
  /** Viewport-relative, as getBoundingClientRect reports it. */
  top: number;
  left: number;
  display: string;
  visibility: string;
  opacity: string;
  /** True when the element or an ancestor is `hidden`, `inert` or aria-hidden. */
  hiddenAttribute: boolean;
  /** offsetParent === null, which catches display:none on any ancestor. */
  detached: boolean;
  /**
   * The browser's own answer, from Element.checkVisibility.
   *
   * `opacity` does not inherit, so an ancestor with `opacity: 0` leaves the
   * computed opacity of the field itself at 1. Reading the element alone
   * therefore says "visible" about a field nobody can see, which is exactly
   * the hole a hidden-field trap is built in. Chrome answers this properly
   * and the manifest already requires 116.
   */
  browserVisible: boolean;
  /**
   * An ancestor that clips this field out of existence: a 1x1 box with
   * `overflow: hidden`, or a `clip-path` that leaves nothing. The field's own
   * rect is full size inside it, so no per-element measurement can see this.
   */
  clipped: boolean;
  /** Document scroll size, used to tell "off-screen" from "below the fold". */
  documentWidth: number;
  documentHeight: number;
}

export interface Classification {
  ref: string;
  kind: FieldKind | null;
  /** Set instead of `kind` when the field belongs to the sensitive class. */
  sensitiveKey: string | null;
  strategy: MatchStrategy | null;
  /** 1.0 for an explicit autocomplete token, lower for a guess. */
  confidence: number;
}

export type SkipReason =
  | 'honeypot'
  | 'hidden'
  | 'sensitive'
  | 'unrecognised'
  | 'unsupported'
  /**
   * A screening question you have not answered yet.
   *
   * Its own reason rather than 'no-value', because this one is actionable:
   * there is a box in the panel where the answer goes, and saying "nothing
   * stored" would hide that from the person who could fix it in ten seconds.
   */
  | 'unanswered'
  | 'no-value'
  | 'already-filled';

/** Your own answers to the screening questions, keyed by kind. */
export type ScreeningAnswers = Partial<Record<FieldKind, string>>;

/** One decided field: a write, a file attachment, or a refusal that says why. */
export type PlannedField =
  | {
      action: 'fill';
      ref: string;
      /** Re-checked against the live element before the write. */
      fingerprint: string;
      label: string;
      kind: FieldKind;
      strategy: MatchStrategy;
      confidence: number;
      value: string;
      /** For a select, the option value chosen from `value`. */
      optionValue?: string;
    }
  | {
      action: 'attach';
      ref: string;
      fingerprint: string;
      label: string;
      /** Which stored file goes in: the résumé, or the cover letter. */
      kind: 'resume_file' | 'cover_letter';
      strategy: MatchStrategy;
      confidence: number;
      /** The filename shown in the review list; the bytes travel separately. */
      filename: string;
    }
  | {
      action: 'skip';
      ref: string;
      label: string;
      reason: SkipReason;
      /** Shown to the user. For a sensitive field this is the registry's reason. */
      detail: string;
      /** Set only when reason is 'sensitive'. */
      sensitiveKey?: string;
    };

export interface FillPlan {
  ats: string;
  fields: PlannedField[];
  /**
   * Custom dropdowns, which are not `<select>` and so are not `fields`.
   *
   * A separate list because they are driven by a separate mechanism: a
   * synchronous open-and-pick rather than a value assignment. Keeping them
   * apart is what stops that mechanism from touching the path that already
   * fills Lever and Greenhouse.
   */
  listboxes: ListboxAction[];
}

/**
 * The values the content script is allowed to know. Assembled in the worker,
 * which is the only context that can decrypt, and deliberately missing every
 * sensitive key: invariant 2 is enforced by the value never being in the
 * message, not by the content script choosing well.
 */
export type FillValues = Partial<Record<FieldKind, string>>;

/**
 * The files a vault stores for attaching: the résumé, and the cover letter.
 * One row each, replaced on upload. The attach action names the field kind
 * (`resume_file`, `cover_letter`); this names the document.
 */
export type DocumentKind = 'resume' | 'cover_letter';
export const DOCUMENT_KINDS: readonly DocumentKind[] = ['resume', 'cover_letter'];

/** The document a field kind attaches, or null for a kind that is typed. */
export function documentFor(kind: FieldKind): DocumentKind | null {
  if (kind === 'resume_file') return 'resume';
  if (kind === 'cover_letter') return 'cover_letter';
  return null;
}

/**
 * A stored file, carried beside the values because it is bytes rather than a
 * string. Base64 because the messaging layer serialises to JSON, and a
 * Uint8Array survives that as an object with numeric keys — silently, which is
 * the failure mode worth spending a few percent of size to avoid.
 */
export interface StoredFile {
  filename: string;
  mimeType: string;
  base64: string;
}

/** The stored files, by document, for the one call that is about to use them. */
export type StoredFiles = Partial<Record<DocumentKind, StoredFile>>;
/** Filenames only, for the planner: the bytes never pass through it. */
export type StoredFilenames = Partial<Record<DocumentKind, string>>;

/** What the background sends the content script. Never a sensitive value. */
export interface FillRequest {
  plan: FillPlan;
  /**
   * Each file present only when the plan actually has something to attach it
   * to.
   *
   * Sending them regardless would put the whole CV in a page's process on
   * every fill, including the many forms with no file input at all, which is
   * the opposite of the reason the plan is built in the background.
   */
  documents: StoredFiles;
  /**
   * The describe pass this plan was built from. The content script refuses a
   * plan from an older pass, so two fills racing cannot apply one plan to the
   * other's elements.
   */
  generation: number;
}

/** What comes back. Counts the gate asserts on, plus the list the panel shows. */
export interface FillReport {
  url: string;
  ats: string;
  filled: number;
  attached: number;
  /** Custom dropdowns answered. Counted apart from `filled` because the
   *  mechanism is different and, unlike `filled`, unverified on a real
   *  tenant — a number that means less should not be added to one that
   *  means more. */
  selected: number;
  skipped: number;
  fields: PlannedField[];
  /** Refs the write step could not complete, with the reason. */
  failures: { ref: string; label: string; detail: string }[];
  /**
   * Dropdowns that were opened and deliberately left as they were.
   *
   * Separate from `failures` because they are not failures. A listbox whose
   * options do not contain the stored answer is a question for the human,
   * and the extension declining to guess is it working. Counting that as
   * "failed" sends somebody looking for a bug in the extension — the same
   * mistake as the single refusal message Phase 3's review had to split.
   */
  declined: { ref: string; label: string; detail: string }[];
  /**
   * Set when the form was not the page itself but an iframe embedded in it.
   * The user clicked on a company careers page; saying where the values
   * actually went is the difference between trusted and merely convenient.
   */
  frameNote?: string | null;
}
