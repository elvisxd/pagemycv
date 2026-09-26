import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ProfileView, VaultState } from '../../db/schema';
import { sendVault } from '../../messaging/vault';
import {
  Button,
  ErrorNote,
  Heading,
  Muted,
  Row,
  Screen,
  Section,
  StateChip,
} from '../../ui/components';
import { MIN_PASSPHRASE } from '../../vault/crypto';

function yearRange(start: string | null, end: string | null): string {
  const from = start ? start.slice(0, 4) : '';
  const to = end ? end.slice(0, 4) : 'Present';
  return from ? `${from} — ${to}` : to;
}

export function App() {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [imported, setImported] = useState<string | null>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);
  const markdownRef = useRef<HTMLTextAreaElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  /**
   * Only the newest request may write state.
   *
   * The first message of a session is slow: it wakes the service worker,
   * creates the offscreen document, spawns the worker and loads SQLite. A
   * refresh issued before an unlock can therefore settle after the one issued
   * by the unlock, and the older answer then overwrites the newer one. The
   * symptom is an unlocked vault showing an empty profile and offering to
   * import a CV over the one already stored, which reads as data loss and
   * invites the user to cause it for real.
   */
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++request.current;
    const state = await sendVault('vault:state', undefined);
    if (mine !== request.current) return;
    if (state.status !== 'unlocked') {
      setVault(state);
      setProfile(null);
      return;
    }
    // Fetch the profile BEFORE publishing the unlocked state. Setting the
    // status first opens a window, as long as the profile query takes, in which
    // the unlocked screen renders with no profile: it shows the fallback title
    // and offers "Import your CV" over the CV already stored. Seeing that
    // immediately after unlocking reads as data loss.
    const view = await sendVault('vault:profile', undefined);
    if (mine !== request.current) return;
    setProfile(view);
    setVault(state);
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  // Focused on purpose rather than with the autoFocus attribute: this screen
  // has exactly one control and nothing to read past, so landing in the field
  // is what a keyboard or screen reader user wants, and doing it here makes
  // that a decision rather than a default.
  useEffect(() => {
    if (vault && vault.status !== 'unlocked') passphraseRef.current?.focus();
  }, [vault]);

  // Opening the import view unmounts the button that opened it, so focus falls
  // to the body and a keyboard user has to tab from the top of the panel.
  // Closing it does the same in reverse.
  useEffect(() => {
    if (showImport) markdownRef.current?.focus();
    else importButtonRef.current?.focus();
  }, [showImport]);

  useEffect(() => {
    if (!showImport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowImport(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showImport]);

  // Keeps the auto-lock honest: the panel being open is not activity, but
  // using it is. Polls the state so an expiry is reflected without a reload.
  useEffect(() => {
    const timer = setInterval(() => {
      const mine = ++request.current;
      sendVault('vault:state', undefined)
        .then((s) => {
          if (mine !== request.current) return;
          setVault(s);
          if (s.status !== 'unlocked') setProfile(null);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const submit = async (kind: 'create' | 'unlock') => {
    setBusy(true);
    setError(null);
    try {
      await sendVault(kind === 'create' ? 'vault:create' : 'vault:unlock', { passphrase });
      setPassphrase('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    setError(null);
    try {
      await sendVault('vault:lock', undefined);
      await refresh();
    } catch (e) {
      // Silence here would leave the panel showing an unlocked vault while the
      // user believes they locked it.
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const importCv = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendVault('vault:importCv', { markdown });
      setImported(
        `${result.counts.work} roles, ${result.counts.education} degrees, ${result.counts.links} links`,
      );
      setMarkdown('');
      setShowImport(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!vault) {
    return (
      <Screen>
        <Heading>PageMyCV</Heading>
        <p role="status" aria-live="polite" style={{ color: 'var(--text-muted)', margin: 0 }}>
          {error ? 'The vault could not be opened.' : 'Opening the vault…'}
        </p>
        {/* This screen used to render nothing but the spinner, so a failure on
            the very first message left it there for good with the reason
            captured in a variable nobody displayed. */}
        {error ? (
          <>
            <ErrorNote>{error}</ErrorNote>
            <div style={{ marginTop: 10 }}>
              <Button
                onClick={() => {
                  setError(null);
                  refresh().catch((e: Error) => setError(e.message));
                }}
              >
                Try again
              </Button>
            </div>
          </>
        ) : null}
      </Screen>
    );
  }

  if (vault.status === 'unavailable') {
    return (
      <Screen>
        <Heading>PageMyCV</Heading>
        <ErrorNote>
          The vault could not be opened: {vault.problem ?? 'unknown reason'}. Nothing has been
          changed. Reopen the panel, and if it persists your data is still on disk.
        </ErrorNote>
      </Screen>
    );
  }

  if (vault.status !== 'unlocked') {
    const creating = vault.status === 'absent';
    return (
      <Screen>
        <Heading>PageMyCV</Heading>
        <Muted>
          {creating
            ? `Choose a passphrase of at least ${MIN_PASSPHRASE} characters. It is never stored, so it cannot be recovered and it cannot be read off this machine.`
            : 'Locked. Your CV stays encrypted until you unlock it.'}
        </Muted>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (passphrase) submit(creating ? 'create' : 'unlock');
          }}
        >
          <input
            type="password"
            ref={passphraseRef}
            autocomplete={creating ? 'new-password' : 'current-password'}
            value={passphrase}
            placeholder="Passphrase"
            aria-label="Passphrase"
            onInput={(e) => setPassphrase((e.target as HTMLInputElement).value)}
            style={{
              width: '100%',
              minHeight: 36,
              padding: '8px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              font: 'inherit',
            }}
          />
          <div style={{ marginTop: 10 }}>
            {/* Not disabled on a short passphrase. A disabled submit button
                also suppresses Enter, so the rule became unexplainable: the
                button did nothing and said nothing. Let the submit through and
                let the worker, which is the authority, say why it refused. */}
            <Button type="submit" disabled={busy || !passphrase}>
              {busy ? 'Working…' : creating ? 'Create the vault' : 'Unlock'}
            </Button>
          </div>
        </form>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </Screen>
    );
  }

  const p = profile;
  return (
    <Screen>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Heading>
          {p?.profile ? `${p.profile.legalFirst} ${p.profile.legalLast}` : 'PageMyCV'}
        </Heading>
        <Button variant="quiet" onClick={lock}>
          Lock
        </Button>
      </div>
      {p?.profile?.headline ? <Muted>{p.profile.headline}</Muted> : null}

      {showImport ? (
        <Section title="Import a CV">
          <div style={{ padding: 12 }}>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Paste the contents of <code>perfil/cv.md</code>. It replaces the experience, education
              and links already stored.
            </p>
            <textarea
              ref={markdownRef}
              value={markdown}
              data-testid="cv-markdown"
              aria-label="CV markdown"
              rows={6}
              onInput={(e) => setMarkdown((e.target as HTMLTextAreaElement).value)}
              style={{
                width: '100%',
                padding: 8,
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Button onClick={importCv} disabled={busy || !markdown.trim()}>
                {busy ? 'Importing…' : 'Import'}
              </Button>
              <Button variant="quiet" onClick={() => setShowImport(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Section>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            buttonRef={importButtonRef}
            variant="quiet"
            onClick={() => {
              setImported(null);
              setError(null);
              setShowImport(true);
            }}
          >
            {p?.profile ? 'Re-import CV' : 'Import your CV'}
          </Button>
          {imported ? (
            <span
              data-testid="import-result"
              role="status"
              aria-live="polite"
              style={{ color: 'var(--text-muted)', fontSize: 11 }}
            >
              {imported}
            </span>
          ) : null}
        </div>
      )}

      {p?.contact ? (
        <Section title="Contact">
          <Row
            title={p.contact.city ? `${p.contact.city}, ${p.contact.region ?? ''}` : 'Location'}
            subtitle={p.contact.email ?? undefined}
            meta={p.contact.phone ?? undefined}
          />
        </Section>
      ) : null}

      {p && p.work.length > 0 ? (
        <Section title={`Experience · ${p.work.length}`}>
          {p.work.map((w) => (
            <Row
              key={w.id}
              title={w.title}
              subtitle={w.employer}
              meta={`${yearRange(w.startedOn, w.endedOn)}${w.isRemote ? ' · Remote' : w.location ? ` · ${w.location}` : ''}`}
            />
          ))}
        </Section>
      ) : null}

      {p && p.education.length > 0 ? (
        <Section title={`Education · ${p.education.length}`}>
          {p.education.map((e) => (
            <Row
              key={e.id}
              title={e.degree ?? e.institution}
              subtitle={e.degree ? e.institution : undefined}
              meta={yearRange(e.startedOn, e.endedOn)}
            />
          ))}
        </Section>
      ) : null}

      {p && p.links.length > 0 ? (
        <Section title="Links">
          {p.links.map((l) => (
            <Row key={l.id} title={l.kind} meta={l.url} />
          ))}
        </Section>
      ) : null}

      {p && p.sensitive.length > 0 ? (
        <Section title={`Sensitive · never filled automatically`}>
          {p.sensitive.map((s) => (
            <Row
              key={s.key}
              title={s.label}
              subtitle={s.reason}
              chip={<StateChip state="sensitive" label={s.hasValue ? 'stored' : 'empty'} />}
            />
          ))}
        </Section>
      ) : null}

      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Screen>
  );
}
