// What the file reader found, laid out to be corrected before it is stored.
//
// The reader (src/import/cv-text.ts) is heuristic and says so; this is the
// other half of that honesty. Nothing it proposes reaches the vault until the
// person has seen every field and pressed Save, and every field is a box they
// can type in, because a wrong value here becomes a wrong value typed into an
// application later. Markdown goes through the same screen: one path, one set
// of eyes on it.
import { useEffect, useRef } from 'preact/hooks';
import type { ParsedCv, ParsedEducation, ParsedWork } from '../../import/cv-markdown';
import { Button, Muted } from '../../ui/components';

export interface CvDraft {
  cv: ParsedCv;
  /** From the reader. Empty for Markdown, which is read by structure. */
  warnings: string[];
  /** Where it came from, for the line above the form. */
  source: string;
}

const inputStyle = {
  width: '100%',
  marginTop: 2,
  padding: '5px 8px',
  boxSizing: 'border-box' as const,
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 12,
};

function Field({
  id,
  label,
  value,
  onChange,
  multiline = false,
  focusRef,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  multiline?: boolean;
  focusRef?: { current: HTMLInputElement | HTMLTextAreaElement | null };
}) {
  // Empty means null all the way down: a blank box is "unknown", and the
  // worker's COALESCE keeps whatever was stored before for a blank.
  const emit = (e: Event) => {
    const v = (e.target as HTMLInputElement | HTMLTextAreaElement).value;
    onChange(v.trim() ? v : null);
  };
  return (
    <label htmlFor={id} style={{ display: 'block', marginTop: 6, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      {multiline ? (
        <textarea
          id={id}
          data-testid={id}
          aria-label={label}
          rows={3}
          value={value ?? ''}
          onInput={emit}
          ref={focusRef as { current: HTMLTextAreaElement | null } | undefined}
          style={inputStyle}
        />
      ) : (
        <input
          id={id}
          data-testid={id}
          aria-label={label}
          value={value ?? ''}
          onInput={emit}
          ref={focusRef as { current: HTMLInputElement | null } | undefined}
          style={inputStyle}
        />
      )}
    </label>
  );
}

const emptyWork = (): ParsedWork => ({
  title: '',
  employer: '',
  location: null,
  isRemote: false,
  startedOn: '',
  endedOn: null,
  description: null,
});

const emptyEducation = (): ParsedEducation => ({
  degree: null,
  institution: '',
  startedOn: null,
  endedOn: null,
});

export function CvReview({
  draft,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: CvDraft;
  busy: boolean;
  onChange: (cv: ParsedCv) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const cv = draft.cv;
  const set = (patch: Partial<ParsedCv>) => onChange({ ...cv, ...patch });
  const setWork = (i: number, patch: Partial<ParsedWork>) =>
    set({ work: cv.work.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const setEducation = (i: number, patch: Partial<ParsedEducation>) =>
    set({ education: cv.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // The form replaces the file picker that opened it, so focus would
  // otherwise fall to the body.
  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  const canSave =
    cv.legalFirst.trim().length > 0 && (cv.work.length > 0 || cv.education.length > 0);

  return (
    <div data-testid="cv-review" style={{ padding: 12 }}>
      <Muted>
        Read from {draft.source}. Check every box — the reader guesses, and a wrong guess here is a
        wrong value typed into an application later. Nothing is stored until you press Save.
      </Muted>
      {draft.warnings.length > 0 ? (
        <ul
          data-testid="cv-warnings"
          style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, color: 'var(--text-muted)' }}
        >
          {draft.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <Field
          id="cv-legalFirst"
          label="First name"
          value={cv.legalFirst}
          onChange={(v) => set({ legalFirst: v ?? '' })}
          focusRef={firstRef}
        />
        <Field
          id="cv-legalLast"
          label="Last name"
          value={cv.legalLast}
          onChange={(v) => set({ legalLast: v ?? '' })}
        />
      </div>
      <Field
        id="cv-headline"
        label="Headline"
        value={cv.headline}
        onChange={(v) => set({ headline: v })}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Field id="cv-email" label="Email" value={cv.email} onChange={(v) => set({ email: v })} />
        <Field id="cv-phone" label="Phone" value={cv.phone} onChange={(v) => set({ phone: v })} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Field id="cv-city" label="City" value={cv.city} onChange={(v) => set({ city: v })} />
        <Field
          id="cv-region"
          label="State or region"
          value={cv.region}
          onChange={(v) => set({ region: v })}
        />
      </div>
      <Field
        id="cv-summary"
        label="Summary"
        value={cv.summary}
        onChange={(v) => set({ summary: v })}
        multiline
      />

      <h3 style={{ fontSize: 12, margin: '14px 0 0' }}>Experience · {cv.work.length}</h3>
      {cv.work.map((w, i) => (
        <div
          // Index keys are right here: rows are edited in place and a removed
          // row shifts the ones below it, which is what the person sees.
          key={i}
          data-testid={`cv-work-${i}`}
          style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 2 }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <Field
              id={`cv-work-${i}-title`}
              label="Title"
              value={w.title}
              onChange={(v) => setWork(i, { title: v ?? '' })}
            />
            <Field
              id={`cv-work-${i}-employer`}
              label="Employer"
              value={w.employer}
              onChange={(v) => setWork(i, { employer: v ?? '' })}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field
              id={`cv-work-${i}-startedOn`}
              label="From (YYYY or YYYY-MM)"
              value={w.startedOn}
              onChange={(v) => setWork(i, { startedOn: v ?? '' })}
            />
            <Field
              id={`cv-work-${i}-endedOn`}
              label="To (blank = current)"
              value={w.endedOn}
              onChange={(v) => setWork(i, { endedOn: v })}
            />
            <Field
              id={`cv-work-${i}-location`}
              label="Place"
              value={w.isRemote ? 'Remote' : w.location}
              onChange={(v) =>
                setWork(
                  i,
                  /^remote$/i.test(v ?? '')
                    ? { isRemote: true, location: null }
                    : { isRemote: false, location: v },
                )
              }
            />
          </div>
          <Field
            id={`cv-work-${i}-description`}
            label="What you did"
            value={w.description}
            onChange={(v) => setWork(i, { description: v })}
            multiline
          />
          <div style={{ marginTop: 4 }}>
            <Button
              variant="quiet"
              onClick={() => set({ work: cv.work.filter((_, j) => j !== i) })}
              disabled={busy}
            >
              Remove this role
            </Button>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 6 }}>
        <Button
          variant="quiet"
          onClick={() => set({ work: [...cv.work, emptyWork()] })}
          disabled={busy}
        >
          Add a role
        </Button>
      </div>

      <h3 style={{ fontSize: 12, margin: '14px 0 0' }}>Education · {cv.education.length}</h3>
      {cv.education.map((e, i) => (
        <div
          key={i}
          data-testid={`cv-education-${i}`}
          style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 2 }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <Field
              id={`cv-education-${i}-degree`}
              label="Degree"
              value={e.degree}
              onChange={(v) => setEducation(i, { degree: v })}
            />
            <Field
              id={`cv-education-${i}-institution`}
              label="Institution"
              value={e.institution}
              onChange={(v) => setEducation(i, { institution: v ?? '' })}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Field
              id={`cv-education-${i}-startedOn`}
              label="From"
              value={e.startedOn}
              onChange={(v) => setEducation(i, { startedOn: v })}
            />
            <Field
              id={`cv-education-${i}-endedOn`}
              label="To"
              value={e.endedOn}
              onChange={(v) => setEducation(i, { endedOn: v })}
            />
          </div>
          <div style={{ marginTop: 4 }}>
            <Button
              variant="quiet"
              onClick={() => set({ education: cv.education.filter((_, j) => j !== i) })}
              disabled={busy}
            >
              Remove this entry
            </Button>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 6 }}>
        <Button
          variant="quiet"
          onClick={() => set({ education: [...cv.education, emptyEducation()] })}
          disabled={busy}
        >
          Add an entry
        </Button>
      </div>

      <h3 style={{ fontSize: 12, margin: '14px 0 0' }}>Links · {cv.links.length}</h3>
      {cv.links.map((l, i) => (
        <Field
          key={i}
          id={`cv-link-${i}-url`}
          label={l.kind}
          value={l.url}
          onChange={(v) =>
            set({
              links: v
                ? cv.links.map((x, j) => (j === i ? { ...x, url: v } : x))
                : cv.links.filter((_, j) => j !== i),
            })
          }
        />
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <Button onClick={onSave} disabled={busy || !canSave}>
          {busy ? 'Saving…' : 'Save to the vault'}
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
      {!canSave ? (
        <Muted>
          A first name and at least one role or degree are needed before this can be saved.
        </Muted>
      ) : null}
    </div>
  );
}
