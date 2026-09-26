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

  const refresh = useCallback(async () => {
    const state = await sendVault('vault:state', undefined);
    setVault(state);
    if (state.status === 'unlocked') setProfile(await sendVault('vault:profile', undefined));
    else setProfile(null);
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

  // Keeps the auto-lock honest: the panel being open is not activity, but
  // using it is. Polls the state so an expiry is reflected without a reload.
  useEffect(() => {
    const timer = setInterval(() => {
      sendVault('vault:state', undefined)
        .then((s) => {
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
    await sendVault('vault:lock', undefined);
    await refresh();
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
        <Muted>Opening the vault…</Muted>
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
            ? 'Choose a passphrase. It is never stored, so it cannot be recovered and it cannot be read off this machine.'
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
          <Button variant="quiet" onClick={() => setShowImport(true)}>
            {p?.profile ? 'Re-import CV' : 'Import your CV'}
          </Button>
          {imported ? (
            <span data-testid="import-result" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
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
