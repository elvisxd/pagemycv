import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { boardList } from '../../ats/registry';
import { type Backup, parseBackup, serializeBackup } from '../../backup/format';
import type { DocumentsMeta, ProfileView, VaultState } from '../../db/schema';
import type {
  DocumentKind,
  FieldKind,
  FillReport,
  PlannedField,
  ScreeningAnswers,
} from '../../fill/types';
import { readCvFile } from '../../import/cv-file';
import { parseCvMarkdown } from '../../import/cv-markdown';
import { parseCvText } from '../../import/cv-text';
import { sendVault } from '../../messaging/vault';
import {
  Button,
  ErrorNote,
  Heading,
  Muted,
  Row,
  Screen,
  Section,
  type State,
  StateChip,
  Tally,
} from '../../ui/components';
import { toBase64 } from '../../util/base64';
import { type CvDraft, CvReview } from './CvReview';

/**
 * How a planned field reads in the review list.
 *
 * A refusal is never silent and never generic: the reason it carries is the
 * reason shown, so a honeypot that was skipped and a field we simply had no
 * value for look different at a glance. A honeypot correctly skipped has to
 * be visible, or nobody can tell the denylist still works.
 */
/**
 * The screening questions, and what each one is for.
 *
 * The hint matters as much as the label: these are answers that get written
 * into real applications, so the box has to say what a good one looks like
 * rather than leaving somebody to guess at the format.
 */
const SCREENING_PROMPTS: readonly {
  kind: FieldKind;
  label: string;
  hint: string;
  multiline?: boolean;
}[] = [
  {
    kind: 'preferred_name',
    label: 'Preferred name',
    hint: 'What you want to be called, if it differs from your legal name. Left blank means left blank — it is never guessed from your CV.',
  },
  {
    kind: 'notice_period',
    label: 'Notice period',
    hint: 'What you owe your current employer. "2 weeks", "1 month", "Immediately".',
  },
  {
    kind: 'travel_ok',
    label: 'Travel',
    hint: 'Whether you accept the travel a role asks for, and any limit.',
  },
  {
    kind: 'relocation_ok',
    label: 'Relocation',
    hint: 'Whether you would move, and where to.',
  },
  {
    kind: 'security_clearance',
    label: 'Security clearance',
    hint: 'Which one you hold, if any. "None" is an answer and is often asked for.',
  },
  {
    kind: 'how_did_you_hear',
    label: 'How you heard about the role',
    hint: 'The one you give most often. Change it per application when it matters.',
  },
  {
    kind: 'cover_letter',
    label: 'Cover letter',
    hint: 'Written by you, typed into a form that has a cover letter box. It is never generated. A letter for one role beats a general one; change it here before each application if you can. Forms that want a file use the cover letter file below instead.',
    multiline: true,
  },
];

/** What each stored file is called in the panel. */
const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  resume: 'Résumé file',
  cover_letter: 'Cover letter file',
};

/** Shown for a type the reader can open. The .doc case has its own message. */
const CV_FILE_ACCEPT =
  '.pdf,.docx,.md,.txt,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain';

const NOT_A_CV =
  'that does not look like a CV: no experience or education was found, so nothing was changed';

function chipFor(field: PlannedField): { state: State; label: string } {
  if (field.action === 'fill') return { state: 'filled', label: field.strategy };
  if (field.action === 'attach') return { state: 'filled', label: 'attached' };
  switch (field.reason) {
    case 'sensitive':
      return { state: 'sensitive', label: 'yours to answer' };
    case 'honeypot':
      return { state: 'review', label: 'honeypot' };
    case 'hidden':
      return { state: 'skipped', label: 'hidden' };
    case 'already-filled':
      return { state: 'skipped', label: 'already filled' };
    case 'unrecognised':
      return { state: 'review', label: 'not recognised' };
    case 'unanswered':
      // Its own chip, because this is the one refusal the person can act on:
      // the answer goes in the box under "Your answers", and calling it
      // "skipped" would hide the one thing they could do about it.
      return { state: 'sensitive', label: 'needs your answer' };
    default:
      return { state: 'skipped', label: 'skipped' };
  }
}

/** Sensitive first, then anything needing attention, then the quiet rows. */
const ROW_ORDER: Record<string, number> = {
  sensitive: 0,
  honeypot: 1,
  unrecognised: 2,
  fill: 3,
  attach: 3,
  'no-value': 4,
  unsupported: 5,
  'already-filled': 6,
  hidden: 7,
};

function sortFields(fields: readonly PlannedField[]): PlannedField[] {
  return [...fields].sort((a, b) => {
    const ka = a.action === 'skip' ? a.reason : a.action;
    const kb = b.action === 'skip' ? b.reason : b.action;
    return (ROW_ORDER[ka] ?? 9) - (ROW_ORDER[kb] ?? 9);
  });
}

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
  /** The paste box, kept for a Markdown CV; the file picker is the front door. */
  const [pasteMode, setPasteMode] = useState(false);
  const [markdown, setMarkdown] = useState('');
  /**
   * What was read and not yet stored. Picking a file never stores anything
   * by itself: the reader guesses, so its result is shown as a form first,
   * and the vault changes when Save is pressed and not before.
   */
  const [draft, setDraft] = useState<(CvDraft & { file: File | null }) | null>(null);
  const [imported, setImported] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentsMeta>({});
  const [report, setReport] = useState<FillReport | null>(null);
  const [filling, setFilling] = useState(false);
  const [answers, setAnswers] = useState<ScreeningAnswers>({});
  const passphraseRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const coverLetterInputRef = useRef<HTMLInputElement>(null);
  const cvFileRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  /**
   * A backup file that has been read and checked, waiting for the person to
   * say yes. Restoring replaces everything, so picking a file never does it
   * by itself: the file is parsed first — a bad one is refused here, having
   * changed nothing — and then the panel says what it would put back.
   */
  const [pendingBackup, setPendingBackup] = useState<{ text: string; backup: Backup } | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
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
    const storedDocuments = await sendVault('vault:documents', undefined);
    const stored = await sendVault('vault:screeningAnswers', undefined);
    if (mine !== request.current) return;
    setProfile(view);
    setDocuments(storedDocuments);
    setAnswers(stored);
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
    if (vault?.status === 'needs_passphrase') passphraseRef.current?.focus();
  }, [vault]);

  // Opening the import view unmounts the button that opened it, so focus falls
  // to the body and a keyboard user has to tab from the top of the panel.
  // Closing it does the same in reverse.
  useEffect(() => {
    if (!showImport) importButtonRef.current?.focus();
    else if (draft)
      return; // the review form focuses its first field itself
    else if (pasteMode) markdownRef.current?.focus();
    else cvFileRef.current?.focus();
  }, [showImport, pasteMode, draft]);

  const closeImport = () => {
    setShowImport(false);
    setDraft(null);
    setPasteMode(false);
  };

  useEffect(() => {
    if (!showImport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeImport();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showImport]);

  const convert = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendVault('vault:convert', { passphrase });
      setPassphrase('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const fill = async () => {
    setFilling(true);
    setError(null);
    setReport(null);
    try {
      setReport(await sendVault('vault:fill', undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFilling(false);
    }
  };

  const storeDocument = async (kind: DocumentKind, file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stored = await sendVault('vault:setDocument', {
      kind,
      filename: file.name,
      // Chrome leaves `type` empty for some uploads; the worker refuses an
      // unrecognised type, so guessing one here would only move the error.
      mimeType: file.type,
      base64: toBase64(bytes),
    });
    setDocuments((d) => ({ ...d, [kind]: stored.meta }));
  };

  const pickDocument = async (kind: DocumentKind, file: File) => {
    setBusy(true);
    setError(null);
    let stored = false;
    try {
      await storeDocument(kind, file);
      stored = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      // Clearing it means picking the same file twice in a row still fires.
      const input = kind === 'resume' ? resumeInputRef.current : coverLetterInputRef.current;
      if (input) input.value = '';
    }
    // A résumé stored into an empty vault is the CV, and the person has just
    // handed it over. Elvis did exactly this — stored the PDF under "Résumé
    // file", pressed Fill, and got "nothing stored for full name" down the
    // whole form — because two things on this panel both looked like "give
    // us your CV" and only one of them read it. So read it: the same review
    // form opens, nothing is stored until Save, and Cancel keeps the file.
    if (stored && kind === 'resume' && !profile?.profile) {
      try {
        setDraft({
          ...(await readCvDraft(file)),
          file: null,
          source: `${file.name}, the résumé file you just stored`,
        });
        setShowImport(true);
      } catch {
        // Not readable as a CV, or not a CV at all. The file is stored either
        // way; the import button stays where it was.
      }
    }
  };

  const exportBackup = async () => {
    setBusy(true);
    setError(null);
    try {
      const backup = await sendVault('vault:exportBackup', undefined);
      // A blob link rather than chrome.downloads: that API is a way out of the
      // machine the guard refuses, and a file saved from the panel's own page
      // needs no permission at all.
      const url = URL.createObjectURL(
        new Blob([serializeBackup(backup)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `pagemycv-backup-${backup.exportedAt.slice(0, 10)}.json`;
      link.click();
      // Revoked after the click has been handled, not during it: revoking in
      // the same task can cancel the download before it starts.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickBackup = async (file: File) => {
    setError(null);
    setRestored(null);
    try {
      const text = await file.text();
      // The same check the worker runs. Here it only decides what to show;
      // the worker runs it again, because the panel is not the authority.
      setPendingBackup({ text, backup: parseBackup(text) });
    } catch (e) {
      setPendingBackup(null);
      setError(`${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
    } finally {
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  const restoreBackup = async () => {
    if (!pendingBackup) return;
    setBusy(true);
    setError(null);
    try {
      const { counts } = await sendVault('vault:importBackup', { text: pendingBackup.text });
      setPendingBackup(null);
      // A fill report on screen lists values written from what was there
      // before; after a restore it describes a vault that no longer exists.
      setReport(null);
      await refresh();
      // Announced after the refresh, for the reason importCv's summary is: a
      // message that runs ahead of the list below it promises what is not
      // shown yet.
      const files = [
        counts.resume ? 'your résumé file' : '',
        counts.coverLetter ? 'your cover letter file' : '',
      ]
        .filter(Boolean)
        .join(' and ');
      setRestored(
        `Restored ${counts.work} roles, ${counts.education} degrees, ${counts.answers} answers${
          files ? ` and ${files}` : ''
        }.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** A file becomes a draft to review. Nothing is stored here. */
  /** Read a file into a draft for review. Throws when it is not a CV. */
  const readCvDraft = async (file: File): Promise<CvDraft & { file: File | null }> => {
    const { kind, lines } = await readCvFile(file);
    const { warnings, ...cv } = parseCvText(lines);
    // The same refusal the worker makes, made here first so the person is
    // told before a form of empty boxes appears. The worker still checks.
    if (cv.work.length === 0 && cv.education.length === 0) throw new Error(NOT_A_CV);
    const label = kind === 'pdf' ? 'PDF' : kind === 'docx' ? 'Word' : 'text';
    return {
      cv,
      warnings,
      source: `${file.name} (${label})`,
      // A PDF or Word CV is also the file to attach to applications. Stored
      // on Save, with the rest, and only if nothing is stored yet — a file
      // chosen on purpose under "Résumé file" is not replaced by accident.
      file: kind === 'pdf' || kind === 'docx' ? file : null,
    };
  };

  const pickCvFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setImported(null);
    try {
      setDraft(await readCvDraft(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (cvFileRef.current) cvFileRef.current.value = '';
    }
  };

  /** Pasted text becomes a draft too: Markdown by structure, anything else by the reader. */
  const readPasted = () => {
    setError(null);
    setImported(null);
    const text = markdown;
    const isMarkdown = /^#\s+\S/m.test(text) && /^##\s+/m.test(text);
    const parsed = isMarkdown
      ? { ...parseCvMarkdown(text), warnings: [] as string[] }
      : parseCvText(text.split(/\r?\n/).map((t) => ({ text: t })));
    const { warnings, ...cv } = parsed;
    if (cv.work.length === 0 && cv.education.length === 0) {
      setError(NOT_A_CV);
      return;
    }
    setDraft({
      cv,
      warnings,
      source: isMarkdown ? 'the pasted Markdown' : 'the pasted text',
      file: null,
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendVault('vault:importCv', { cv: draft.cv });
      if (draft.file && !documents.resume) await storeDocument('resume', draft.file);
      setMarkdown('');
      closeImport();
      // Refresh BEFORE announcing the result. Announcing first says "5 roles,
      // 2 degrees" while the list below still shows what was there before,
      // which is a promise made ahead of the thing it promises. The gate read
      // the panel the moment that text appeared and found no experience
      // section at all, and adding a third call to refresh() widened the
      // window enough for it to happen most runs.
      await refresh();
      setImported(
        `${result.counts.work} roles, ${result.counts.education} degrees, ${result.counts.links} links`,
      );
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

  // The ONLY screen left that asks for anything, and only for vaults made
  // before the passphrase was dropped. A new vault never reaches it.
  if (vault.status === 'needs_passphrase') {
    return (
      <Screen>
        <Heading>PageMyCV</Heading>
        <Muted>
          This vault was made with a passphrase. Enter it once and PageMyCV will open by itself from
          now on.
        </Muted>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (passphrase) convert();
          }}
        >
          <input
            type="password"
            ref={passphraseRef}
            autocomplete="current-password"
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
              {busy ? 'Working…' : 'Open it'}
            </Button>
          </div>
        </form>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </Screen>
    );
  }

  if (vault.status !== 'unlocked') {
    // 'absent' and 'opening' are both transient: the offscreen document
    // creates or opens the vault before any command returns, so this is what
    // the first frame looks like, not a state anybody sits in.
    return (
      <Screen>
        <Heading>PageMyCV</Heading>
        <Muted>Opening…</Muted>
      </Screen>
    );
  }

  const p = profile;
  return (
    <Screen>
      <Heading>
        {p?.profile ? `${p.profile.legalFirst} ${p.profile.legalLast}` : 'PageMyCV'}
      </Heading>
      {p?.profile?.headline ? <Muted>{p.profile.headline}</Muted> : null}

      {showImport && draft ? (
        <Section title="Import a CV · check it first">
          <CvReview
            draft={draft}
            busy={busy}
            onChange={(cv) => setDraft({ ...draft, cv })}
            onSave={saveDraft}
            onCancel={() => setDraft(null)}
          />
        </Section>
      ) : showImport ? (
        <Section title="Import a CV">
          <div style={{ padding: 12 }}>
            {pasteMode ? (
              <>
                <p style={{ color: 'var(--text-muted)', margin: '0 0 8px' }}>
                  Paste your CV as text or Markdown. You will see what was read before anything is
                  stored. It replaces the experience, education and links already here.
                </p>
                <textarea
                  ref={markdownRef}
                  value={markdown}
                  data-testid="cv-markdown"
                  aria-label="CV text"
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
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <Button onClick={readPasted} disabled={busy || !markdown.trim()}>
                    Read it
                  </Button>
                  <Button variant="quiet" onClick={() => setPasteMode(false)} disabled={busy}>
                    Use a file instead
                  </Button>
                  <Button variant="quiet" onClick={closeImport} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--text-muted)', margin: '0 0 8px' }}>
                  Choose the CV you already have, as a PDF or a Word file. It is read here, on this
                  machine, and shown to you to correct before anything is stored. It replaces the
                  experience, education and links already here, and becomes the file attached to
                  applications if none is stored yet.
                </p>
                <input
                  id="cv-file"
                  data-testid="cv-file"
                  ref={cvFileRef}
                  type="file"
                  aria-label="CV file"
                  accept={CV_FILE_ACCEPT}
                  disabled={busy}
                  onChange={(e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) pickCvFile(file);
                  }}
                  style={{ font: 'inherit', fontSize: 11, maxWidth: '100%' }}
                />
                {busy ? <Muted>Reading the file…</Muted> : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <Button variant="quiet" onClick={() => setPasteMode(true)} disabled={busy}>
                    Paste text instead
                  </Button>
                  <Button variant="quiet" onClick={closeImport} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
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

      <Section title="Fill a form">
        <div style={{ padding: 12 }}>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 8px' }}>
            Open an application form in the active tab. On {boardList('or')} it fills at once; on
            any other site, click the PageMyCV icon in the toolbar first so Chrome lets it read that
            one page. It fills what it recognises, highlights every value it wrote, and never
            submits: the last click is always yours.
          </p>
          {!p?.profile ? (
            <p
              data-testid="no-cv-note"
              style={{ color: 'var(--text)', margin: '0 0 8px', fontSize: 12 }}
            >
              No CV has been imported yet, so there is no name, email or phone to fill. Storing a
              résumé file below attaches it to applications but does not read it; use{' '}
              <strong>Import your CV</strong> above, or pick the résumé file and it is read for you.
            </p>
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button onClick={fill} disabled={filling || busy}>
              {filling ? 'Filling…' : 'Fill this form'}
            </Button>
            {report ? (
              <Button
                variant="quiet"
                onClick={() => {
                  setReport(null);
                  sendVault('vault:clearFill', undefined).catch(() => {});
                }}
              >
                Clear highlights
              </Button>
            ) : null}
          </div>

          {(['resume', 'cover_letter'] as const).map((kind) => {
            const id = kind === 'resume' ? 'resume-file' : 'cover-letter-file';
            const stored = documents[kind];
            return (
              <div key={kind} style={{ marginTop: 12 }}>
                <label
                  htmlFor={id}
                  style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}
                >
                  {DOCUMENT_LABELS[kind]} {stored ? `· ${stored.filename}` : '· none stored'}
                </label>
                <input
                  id={id}
                  ref={kind === 'resume' ? resumeInputRef : coverLetterInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.md,.txt,application/pdf,application/msword,text/markdown,text/plain"
                  disabled={busy}
                  onChange={(e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) pickDocument(kind, file);
                  }}
                  style={{ marginTop: 4, font: 'inherit', fontSize: 11, maxWidth: '100%' }}
                />
              </div>
            );
          })}

          {report?.frameNote ? (
            <p
              data-testid="frame-note"
              style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}
            >
              {report.frameNote}
            </p>
          ) : null}

          {report ? (
            <div role="status" aria-live="polite" data-testid="fill-report">
              <Tally
                counts={[
                  {
                    state: 'filled',
                    label: 'filled',
                    // `selected` belongs here. A dropdown we opened and
                    // answered is filled; leaving it out of the tally made
                    // the one thing the listbox code did invisible.
                    n: report.filled + report.attached + report.selected,
                  },
                  {
                    state: 'sensitive',
                    label: 'left to you',
                    // Declined dropdowns are left to you, not failures.
                    n:
                      report.fields.filter((f) => f.action === 'skip' && f.reason === 'sensitive')
                        .length + report.declined.length,
                  },
                  {
                    state: 'review',
                    label: 'honeypots refused',
                    n: report.fields.filter((f) => f.action === 'skip' && f.reason === 'honeypot')
                      .length,
                  },
                  { state: 'skipped', label: 'skipped', n: report.skipped },
                  { state: 'error', label: 'failed', n: report.failures.length },
                ]}
              />
            </div>
          ) : null}
        </div>
      </Section>

      {report ? (
        <Section title={`Review · ${report.fields.length} fields`}>
          {sortFields(report.fields).map((f) => {
            const chip = chipFor(f);
            return (
              <Row
                key={f.ref}
                title={f.label}
                subtitle={f.action === 'skip' ? f.detail : undefined}
                meta={
                  f.action === 'fill' ? f.value : f.action === 'attach' ? f.filename : undefined
                }
                chip={<StateChip state={chip.state} label={chip.label} />}
              />
            );
          })}
          {report.declined.map((f) => (
            <Row
              key={`declined-${f.ref}`}
              title={f.label}
              subtitle={f.detail}
              chip={<StateChip state="sensitive" label="left to you" />}
            />
          ))}
          {report.failures.map((f) => (
            <Row
              key={`fail-${f.ref}`}
              title={f.label}
              subtitle={f.detail}
              chip={<StateChip state="error" label="failed" />}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Your answers">
        <Muted>
          The questions every application asks and no CV answers. Typed once, stored encrypted, and
          written only into a field that asks for that exact thing. Nothing here is ever guessed
          from your CV.
        </Muted>
        {SCREENING_PROMPTS.map(({ kind, label, hint, multiline }) => {
          const onInput = (e: Event) =>
            setAnswers({ ...answers, [kind]: (e.target as HTMLInputElement).value });
          const onBlur = (e: Event) => {
            const answer = (e.target as HTMLInputElement).value;
            sendVault('vault:setScreeningAnswer', { kind, answer })
              .then(() => refresh())
              .catch((err: Error) => setError(err.message));
          };
          const style = {
            width: '100%',
            marginTop: 4,
            padding: '6px 8px',
            boxSizing: 'border-box' as const,
          };
          return (
            <label
              key={kind}
              htmlFor={`answer-${kind}`}
              style={{ display: 'block', marginTop: 10 }}
            >
              <span style={{ fontSize: 12, color: 'var(--text)' }}>{label}</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>
                {hint}
              </span>
              {multiline ? (
                <textarea
                  id={`answer-${kind}`}
                  data-testid={`answer-${kind}`}
                  value={answers[kind] ?? ''}
                  disabled={busy}
                  rows={5}
                  onInput={onInput}
                  onBlur={onBlur}
                  style={{ ...style, font: 'inherit', fontSize: 12 }}
                />
              ) : (
                <input
                  id={`answer-${kind}`}
                  data-testid={`answer-${kind}`}
                  value={answers[kind] ?? ''}
                  disabled={busy}
                  onInput={onInput}
                  onBlur={onBlur}
                  style={style}
                />
              )}
            </label>
          );
        })}
      </Section>

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

      <Section title="Backup">
        <Muted>
          Everything you entered, in one file you can restore here or in a new browser. The file is
          not encrypted: whoever has it can read your CV and your answers.
        </Muted>
        <div style={{ marginTop: 8 }}>
          <Button onClick={exportBackup} disabled={busy}>
            Export backup
          </Button>
        </div>
        <div style={{ marginTop: 12 }}>
          <label
            htmlFor="backup-file"
            style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}
          >
            Restore from a backup · replaces what is here
          </label>
          <input
            id="backup-file"
            data-testid="backup-file"
            ref={backupInputRef}
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) pickBackup(file);
            }}
            style={{ marginTop: 4, font: 'inherit', fontSize: 11, maxWidth: '100%' }}
          />
        </div>
        {pendingBackup ? (
          <div data-testid="backup-confirm" style={{ marginTop: 10 }}>
            <p style={{ margin: '0 0 8px', fontSize: 12 }}>
              Replace everything here with the backup
              {pendingBackup.backup.exportedAt
                ? ` from ${pendingBackup.backup.exportedAt.slice(0, 10)}`
                : ''}
              {pendingBackup.backup.profile
                ? ` of ${pendingBackup.backup.profile.legalFirst} ${pendingBackup.backup.profile.legalLast}`
                : ''}
              ? It has {pendingBackup.backup.work.length} roles,{' '}
              {Object.keys(pendingBackup.backup.screeningAnswers).length} answers
              {pendingBackup.backup.resume ? ' and a résumé file' : ' and no résumé file'}
              {pendingBackup.backup.coverLetter ? ', plus a cover letter file' : ''}.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={restoreBackup} disabled={busy}>
                {busy ? 'Restoring…' : 'Replace and restore'}
              </Button>
              <Button variant="quiet" onClick={() => setPendingBackup(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {restored ? (
          <p
            role="status"
            data-testid="backup-result"
            style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}
          >
            {restored}
          </p>
        ) : null}
      </Section>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Screen>
  );
}
