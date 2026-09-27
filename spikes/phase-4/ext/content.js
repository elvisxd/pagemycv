// Every Phase 4 question that can only be answered by a content script.
//
// `chrome.dom.openOrClosedShadowRoot` is documented as available to content
// scripts and to nothing else — not to the page, not to Playwright's
// evaluate, not to the service worker. So the probes run here and the runner
// reads the answers back through the background.

const SELECTOR = 'input, select, textarea';

/** Walk into every shadow root, open or closed, collecting controls. */
function deepControls(root, out = [], depth = 0) {
  if (depth > 20) return out;
  for (const el of root.querySelectorAll('*')) {
    if (el.matches?.(SELECTOR)) out.push(el);
    const shadow = chrome.dom?.openOrClosedShadowRoot?.(el) ?? el.shadowRoot;
    if (shadow) deepControls(shadow, out, depth + 1);
  }
  return out;
}

const PROBES = {
  // 1. Does the API exist at all, with zero permissions?
  apiPresent: () => ({
    chromeDom: typeof chrome.dom,
    openOrClosedShadowRoot: typeof chrome.dom?.openOrClosedShadowRoot,
  }),

  // 2. The page attached its roots as CLOSED. Confirm that from here, so a
  //    pass below cannot be a pass against an open root by accident.
  rootsReallyClosed: () => {
    const hosts = [...document.querySelectorAll('[data-shadow-host]')];
    return hosts.map((h) => ({
      host: h.dataset.shadowHost,
      // What the page itself can see. Null is what "closed" means.
      pageVisible: h.shadowRoot !== null,
      // What we can see.
      weCanSee: chrome.dom.openOrClosedShadowRoot(h) !== null,
    }));
  },

  // 3. Everything reachable, flat vs deep. The gap is the whole question.
  reach: () => {
    const flat = document.querySelectorAll(SELECTOR).length;
    const deep = deepControls(document).length;
    return {
      flat,
      deep,
      names: deepControls(document).map((e) => e.name || e.id || e.type),
    };
  },

  // 4. Can we WRITE across a closed boundary, and does a listener registered
  //    INSIDE that root see the events? Filling is worthless if the
  //    framework never hears about it.
  write: () => {
    const target = deepControls(document).find((e) => e.name === 'firstName');
    if (!target) return { found: false };
    const proto = Object.getPrototypeOf(target);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter.call(target, 'Ada');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      found: true,
      value: target.value,
      // The page records what its own in-shadow listener heard.
      heardInsideShadow: document.body.dataset.shadowHeard ?? '(nothing)',
      // Did the event escape the root and reach the document? Composed
      // events do; this says which kind we are dealing with.
      heardAtDocument: document.body.dataset.documentHeard ?? '(nothing)',
    };
  },

  // 4b. The event kind. A bubbling event stops at a shadow boundary; only a
  //     `composed` one crosses it, and it arrives retargeted at the host.
  //     write.ts dispatches the non-composed kind today.
  writeComposed: () => {
    const target = deepControls(document).find((e) => e.name === 'lastName');
    if (!target) return { found: false };
    const proto = Object.getPrototypeOf(target);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, 'Lovelace');
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return {
      found: true,
      value: target.value,
      heardAtDocument: document.body.dataset.documentHeard ?? '(nothing)',
    };
  },

  // 5. Our visibility gate calls checkVisibility(). Does it work in there?
  visibility: () => {
    const all = deepControls(document);
    const pick = (n) => all.find((e) => e.name === n);
    const report = (el) =>
      !el
        ? null
        : {
            checkVisibility: el.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            }),
            rect: (({ width, height }) => ({ width, height }))(el.getBoundingClientRect()),
          };
    return { firstName: report(pick('firstName')), beecatcher: report(pick('beecatcher')) };
  },

  // 6. Labels. ids are scoped PER ROOT, so document.getElementById cannot see
  //    a control inside a shadow root and label[for] must be resolved in the
  //    root that owns it. This is the trap for descriptor.ts as written.
  labels: () => {
    const target = deepControls(document).find((e) => e.name === 'firstName');
    if (!target) return { found: false };
    const root = target.getRootNode();
    return {
      found: true,
      id: target.id,
      // What descriptor.ts does today.
      viaDocument: document.getElementById(target.id) === target,
      viaDocumentQuery: !!document.querySelector(`label[for="${CSS.escape(target.id)}"]`),
      // What it would have to do instead.
      rootIsShadow: root instanceof ShadowRoot,
      viaRootQuery: root.querySelector(`label[for="${CSS.escape(target.id)}"]`)?.textContent?.trim() ?? null,
      viaLabelsProperty: [...(target.labels ?? [])].map((l) => l.textContent.trim()),
      // closest() stops at the shadow boundary, which breaks the wrapper walk.
      closestForm: target.closest('form') !== null,
    };
  },

  // 7. A frame nested inside a shadow root. The docs say unreachable by
  //    design. If that is wrong in either direction Phase 4 changes shape.
  frameInShadow: () => {
    const hosts = [...document.querySelectorAll('[data-shadow-host="framed"]')];
    const root = hosts[0] ? chrome.dom.openOrClosedShadowRoot(hosts[0]) : null;
    const iframe = root?.querySelector('iframe') ?? null;
    return {
      hostFound: !!hosts[0],
      iframeFound: !!iframe,
      src: iframe?.getAttribute('src') ?? null,
      // A content script in that frame would announce itself separately; the
      // runner checks the roster. From here we can only say whether the
      // element exists.
    };
  },

  // 8. The overlay. A real click is intercepted; the question is whether a
  //    dispatched event still reaches the button under it.
  overlay: () => {
    const btn = document.querySelector('[data-automation-id="pageFooterNextButton"]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const atPoint = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    return {
      found: true,
      // Who actually owns that pixel. Not the button means a real click misses.
      elementAtPoint: atPoint?.getAttribute('data-automation-id') ?? atPoint?.tagName ?? null,
      intercepted: atPoint !== btn,
      dispatchedClickLanded: document.body.dataset.nextClicked === 'yes',
    };
  },

  // 9. The custom listbox, and the claim that it closes between round trips.
  listboxSync: () => {
    const trigger = document.querySelector('[data-automation-id="formField-countryRegion"] button');
    if (!trigger) return { found: false };
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    // Synchronous, in the same task: what the plan says is the only way.
    const now = document.querySelectorAll('[role="option"]').length;
    return { found: true, optionsSynchronously: now };
  },
  listboxAsync: async () => {
    const trigger = document.querySelector('[data-automation-id="formField-countryRegion"] button');
    if (!trigger) return { found: false };
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 0));
    const afterTask = document.querySelectorAll('[role="option"]').length;
    return { found: true, optionsAfterOneTask: afterTask };
  },
};

chrome.runtime.sendMessage({ kind: 'here', url: location.href, isTop: window.top === window.self });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.kind !== 'probe') return false;
  (async () => {
    try {
      reply({ ok: true, value: await PROBES[msg.question]() });
    } catch (e) {
      reply({ ok: false, error: String(e) });
    }
  })();
  return true;
});
