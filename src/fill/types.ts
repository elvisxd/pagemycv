// The vocabulary the fill path speaks. Nothing here touches the DOM or the
// vault: the classifier, the planner and their tests all work on these plain
// records, which is what makes the interesting logic testable without a
// browser.

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
  | 'how_did_you_hear';

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
  | 'never-auto'
  | 'no-value'
  | 'already-filled';

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
      kind: 'resume_file';
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
}

/**
 * The values the content script is allowed to know. Assembled in the worker,
 * which is the only context that can decrypt, and deliberately missing every
 * sensitive key: invariant 2 is enforced by the value never being in the
 * message, not by the content script choosing well.
 */
export type FillValues = Partial<Record<FieldKind, string>>;

/**
 * The stored resume, carried beside the values because it is bytes rather than
 * a string. Base64 because the messaging layer serialises to JSON, and a
 * Uint8Array survives that as an object with numeric keys — silently, which is
 * the failure mode worth spending a few percent of size to avoid.
 */
export interface ResumeFile {
  filename: string;
  mimeType: string;
  base64: string;
}

/** What the background sends the content script. Never a sensitive value. */
export interface FillRequest {
  plan: FillPlan;
  /**
   * Present only when the plan actually has something to attach it to.
   *
   * Sending it regardless would put the whole CV in a page's process on every
   * fill, including the many forms with no file input at all, which is the
   * opposite of the reason the plan is built in the background.
   */
  resume: ResumeFile | null;
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
  skipped: number;
  fields: PlannedField[];
  /** Refs the write step could not complete, with the reason. */
  failures: { ref: string; label: string; detail: string }[];
}
