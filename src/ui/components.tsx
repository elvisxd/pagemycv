import type { ComponentChildren, Ref } from 'preact';

export function Screen({ children }: { children: ComponentChildren }) {
  return <div style={{ padding: '16px', maxWidth: 420, margin: '0 auto' }}>{children}</div>;
}

export function Heading({ children }: { children: ComponentChildren }) {
  return (
    <h1 style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700, margin: '0 0 4px' }}>
      {children}
    </h1>
  );
}

export function Muted({ children }: { children: ComponentChildren }) {
  return <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{children}</p>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
  buttonRef,
}: {
  children: ComponentChildren;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'quiet';
  type?: 'button' | 'submit';
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const primary = variant === 'primary';
  return (
    <button
      ref={buttonRef}
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        // WCAG 2.2 criterion 2.5.8 wants 24px minimum; 32 is comfortable and still compact.
        minHeight: 32,
        padding: '6px 14px',
        borderRadius: 6,
        border: `1px solid ${primary ? 'transparent' : 'var(--border)'}`,
        background: primary ? 'var(--brand)' : 'transparent',
        color: primary ? 'var(--brand-contrast)' : 'var(--text)',
        opacity: disabled ? 0.5 : 1,
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}

export type State = 'filled' | 'review' | 'sensitive' | 'skipped' | 'error';

const GLYPH: Record<State, string> = {
  filled: '✓',
  review: '!',
  sensitive: '◆',
  skipped: '–',
  error: '×',
};

/** A count with its own label, for the one-line summary above a review list. */
export function Tally({ counts }: { counts: { state: State; label: string; n: number }[] }) {
  const shown = counts.filter((c) => c.n > 0);
  if (shown.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 0' }}>
      {shown.map((c) => (
        <StateChip key={c.label} state={c.state} label={`${c.n} ${c.label}`} />
      ))}
    </div>
  );
}

/** State is never colour alone: a glyph and a label carry it too. */
export function StateChip({ state, label }: { state: State; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '1px 7px',
        borderRadius: 999,
        fontSize: 11,
        lineHeight: '16px',
        color: `var(--${state})`,
        background: `var(--${state}-bg)`,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true" style={{ color: `var(--${state}-glyph)` }}>
        {GLYPH[state]}
      </span>
      {label}
    </span>
  );
}

export function Row({
  title,
  subtitle,
  meta,
  chip,
}: {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  chip?: ComponentChildren;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 12px',
        borderTop: '1px solid var(--border)',
        minHeight: 44,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, lineHeight: '22px', fontWeight: 500 }}>{title}</div>
        {subtitle ? <div style={{ color: 'var(--text-muted)' }}>{subtitle}</div> : null}
        {meta ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            {meta}
          </div>
        ) : null}
      </div>
      {chip}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section style={{ marginTop: 20 }}>
      <h2
        style={{
          fontSize: 11,
          lineHeight: '16px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          margin: '0 0 2px',
          fontWeight: 500,
        }}
      >
        {title}
      </h2>
      <div style={{ background: 'var(--surface)', borderRadius: 8, overflow: 'hidden' }}>
        {children}
      </div>
    </section>
  );
}

export function ErrorNote({ children }: { children: ComponentChildren }) {
  return (
    <p role="alert" style={{ color: 'var(--error)', margin: '8px 0 0' }}>
      {children}
    </p>
  );
}
