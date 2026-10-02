// The ONLY module that calls chrome.scripting, and the only way a content
// script reaches a page the manifest does not name.
//
// It is a door for the same reason crypto.subtle and the key store have one:
// this is the call that widens where the extension's code runs, and a second
// caller is a second place that can get the target wrong. The guard
// enforces it.
//
// What it can and cannot do is Chrome's decision, not ours. With `activeTab`
// and no host permissions, this succeeds only on the tab the person last
// invoked the extension on — by clicking its icon — and only until they
// navigate away. On any other tab Chrome refuses, and that refusal is turned
// into the message in src/fill/on-demand.ts. Nothing here can reach a page
// the person did not point at.
//
// Measured in spikes/phase-6 rather than assumed: no route to that grant can
// be driven from the browser gate, so the one line below that does the work
// is the one line in the fill path CI cannot exercise.

/**
 * The file the manifest declares for the known boards. Read from the
 * manifest rather than written out again, so the script injected on demand
 * is provably the same one, not a copy that can drift.
 */
export function declaredContentScriptFiles(): string[] {
  const declared = chrome.runtime.getManifest().content_scripts ?? [];
  const files = declared.flatMap((c) => c.js ?? []);
  if (files.length === 0) throw new Error('the manifest declares no content script to inject');
  return files;
}

export async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    // Every frame Chrome lets us into. On a careers page that embeds a board
    // we already declare, the embed is injected by the manifest and this
    // never runs. Whether `activeTab` extends to a cross-origin frame — an
    // unknown page embedding a form from a second unknown origin — is NOT
    // known: it cannot be measured headlessly for the same reason the grant
    // cannot, and nobody has tried it on a real page yet. Until then, expect
    // the embedded form not to be reached, and the person to open its own
    // page instead. docs/04-phases.md carries the same note.
    target: { tabId, allFrames: true },
    files: declaredContentScriptFiles(),
  });
}

/**
 * Chrome's wording when the tab was not granted. Matched loosely because it
 * has been reworded across versions; the two fixed points are "access" and
 * "permission".
 */
export function isAccessRefused(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /cannot access|must request permission|not allowed|activeTab|host permission/i.test(
    message,
  );
}
