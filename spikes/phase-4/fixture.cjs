// A page built to be hostile in the specific ways Workday is documented to be
// hostile. It is NOT a copy of Workday — nothing here was scraped from a real
// tenant, and the runner says so in its output. Its job is to hold the traps
// still so a browser API can be tested against them.
module.exports = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Apply — Acme</title>
<style>
  .overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.001); }
  .off { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style></head>
<body>
<h1>Application</h1>

<!-- ── My Information, inside a CLOSED shadow root ──────────────────── -->
<my-information data-shadow-host="myInformation"></my-information>

<!-- ── A frame nested inside a closed shadow root ───────────────────── -->
<framed-section data-shadow-host="framed"></framed-section>

<!-- ── A custom listbox in the light DOM, so the menu-lifetime question
       is tested on its own rather than tangled with the shadow one ──── -->
<div data-automation-id="formField-countryRegion">
  <button type="button" aria-haspopup="listbox">Country</button>
  <div class="menu"></div>
</div>

<!-- ── The Next button, under a full-page transparent overlay ───────── -->
<button type="button" data-automation-id="pageFooterNextButton">Next</button>
<div class="overlay" data-automation-id="clickBlocker"></div>

<script>
(() => {
  // ---- closed root #1, with the fields, a scoped label, and a honeypot ----
  const host = document.querySelector('my-information');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = \`
    <style>
      /* Inside the root, because a document stylesheet does not cross the
         boundary. The first run of this spike put it outside and the
         honeypot came back visible — not because the gate failed but
         because the rule never applied. */
      .off { position: absolute; width: 1px; height: 1px;
             overflow: hidden; clip-path: inset(50%); }
    </style>
    <label for="firstName-input">First Name</label>
    <input id="firstName-input" name="firstName"
           data-automation-id="formField-legalName--firstName">
    <label for="lastName-input">Last Name</label>
    <input id="lastName-input" name="lastName">
    <!-- The honeypot, inside the closed root and hidden the way Workday
         hides it. If the denylist cannot see it, it cannot refuse it. -->
    <input name="beecatcher" data-automation-id="beecatcher" class="off"
           aria-hidden="true" tabindex="-1"
           aria-label="This input is for robots only, do not enter if you're human.">
    <nested-block data-shadow-host="nested"></nested-block>\`;

  // A listener INSIDE the root. Whether it hears our write is the question
  // that decides if filling a Workday field does anything at all.
  root.addEventListener('input', (e) => {
    document.body.dataset.shadowHeard = e.target.name + '=' + e.target.value;
  });
  document.addEventListener('input', (e) => {
    // A composed event crosses the boundary and is retargeted at the HOST.
    // A plain bubbling one never arrives at all. Which of those Workday's
    // own listener sees is the difference between filling a field and
    // appearing to fill it.
    const heard = document.body.dataset.documentHeard || '';
    document.body.dataset.documentHeard = heard + (e.target.tagName || '?').toLowerCase() + ';';
  });

  // ---- closed root #2, nested inside the first ----
  const nested = root.querySelector('nested-block');
  const deep = nested.attachShadow({ mode: 'closed' });
  deep.innerHTML = '<input name="deeplyNested" data-automation-id="formField-source">';

  // ---- a frame inside a closed root ----
  const framedHost = document.querySelector('framed-section');
  const framedRoot = framedHost.attachShadow({ mode: 'closed' });
  framedRoot.innerHTML =
    '<iframe src="https://acme.wd5.myworkdayjobs.com/embedded-step"></iframe>';

  // ---- the listbox: options exist only within the task that opened it ----
  const combo = document.querySelector('[data-automation-id="formField-countryRegion"]');
  combo.querySelector('button').addEventListener('click', () => {
    const menu = combo.querySelector('.menu');
    menu.innerHTML = ['Spain', 'Ireland', 'Portugal']
      .map((c) => '<div role="option">' + c + '</div>')
      .join('');
    // The documented behaviour: it is gone by the next task.
    setTimeout(() => { menu.innerHTML = ''; }, 0);
  });

  // ---- the Next button records whether a dispatched click reached it ----
  document.querySelector('[data-automation-id="pageFooterNextButton"]')
    .addEventListener('click', () => { document.body.dataset.nextClicked = 'yes'; });
})();
</script>
</body></html>`;
