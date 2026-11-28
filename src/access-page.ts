/** The /access early-access page, served on 1sensedata.com/access via a zone
 * route in wrangler.jsonc. Design matches the 1sensedata.com landing page
 * (Petrona/Instrument Sans, ink-on-paper palette). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export { EMAIL_RE };

function page(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>1Sense — early access</title>
<meta name="description" content="Request early access to 1Sense: owner chains and company property holdings for German commercial property.">
<link rel="canonical" href="https://1sensedata.com/access">
<link rel="stylesheet" href="https://fonts.bunny.net/css?family=petrona:400,600|instrument-sans:400&display=swap">
<style>
:root {
  --ink: #1f2322;
  --paper: #ffffff;
  --sand-100: #f4efec;
  --sand-400: #e1d5cd;
  --rule: rgba(31, 35, 34, 0.2);
  --error: #b3261e;
  --font-text: "Petrona", "Iowan Old Style", Georgia, serif;
  --font-small: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-text);
  font-size: 21px;
  line-height: 1.55;
}
main { max-width: 680px; margin: 0 auto; padding: 48px 20px 80px; }
a { color: inherit; }
.top { font-family: var(--font-small); font-size: 15px; margin-bottom: 56px; }
.top a { text-decoration: none; border-bottom: 1px solid var(--rule); }
h1 { font-size: 40px; font-weight: 600; line-height: 1.15; margin: 0 0 24px; }
p { margin: 0 0 20px; }
ul { margin: 0 0 24px; padding-left: 24px; }
li { margin-bottom: 10px; }
.note {
  font-family: var(--font-small);
  font-size: 15px;
  color: rgba(31, 35, 34, 0.75);
  background: var(--sand-100);
  border-radius: 8px;
  padding: 14px 16px;
  margin: 28px 0;
}
.note code { font-size: 13px; background: var(--sand-400); padding: 1px 5px; border-radius: 4px; }
form { margin: 36px 0 0; }
label { display: block; font-family: var(--font-small); font-size: 15px; margin: 0 0 6px; }
input[type="email"], textarea {
  width: 100%;
  font-family: var(--font-small);
  font-size: 17px;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 20px;
}
input:focus, textarea:focus { outline: 2px solid var(--ink); outline-offset: 1px; }
textarea { min-height: 110px; resize: vertical; }
.trap { position: absolute; left: -9999px; opacity: 0; height: 0; }
button {
  font-family: var(--font-text);
  font-size: 21px;
  font-weight: 600;
  color: var(--paper);
  background: var(--ink);
  border: 0;
  border-radius: 8px;
  padding: 12px 28px;
  cursor: pointer;
}
button:hover { opacity: 0.9; }
.error { color: var(--error); font-family: var(--font-small); font-size: 15px; }
.ok {
  background: var(--sand-100);
  border-radius: 8px;
  padding: 24px 24px 12px;
  margin-top: 36px;
}
footer {
  margin-top: 72px;
  padding-top: 20px;
  border-top: 1px solid var(--rule);
  font-family: var(--font-small);
  font-size: 13px;
  color: rgba(31, 35, 34, 0.65);
}
footer a { margin-right: 16px; }
</style>
</head>
<body>
<main>
  <nav class="top"><a href="https://1sensedata.com/">← 1Sense</a></nav>
  ${body}
  <footer>
    <a href="https://1sensedata.com/imprint">Legal notice</a>
    <a href="https://1sensedata.com/privacy">Privacy policy</a>
    <span>© 2026 1Sense</span>
  </footer>
</main>
</body>
</html>`;
}

export function accessPage(opts: { error?: string } = {}): string {
  return page(`
  <h1>Early access</h1>
  <p>1Sense is a map of who owns German commercial property. The open tools —
  parcels, Bodenrichtwerte, company register — are free to use. Early access
  unlocks the part that answers the real question:</p>
  <ul>
    <li><strong>Owner chains</strong> — from a parcel to the entity that stands behind it, through every intermediate holding.</li>
    <li><strong>Company property holdings</strong> — everything an owner holds, across cities.</li>
    <li><strong>Higher limits</strong> — anonymous use is capped at 10 calls a day; early access lifts that.</li>
  </ul>
  <p>1Sense opens to a small group first. Tell us what you want to do with the
  data, and we will write to you when your access is ready.</p>
  ${opts.error ? `<p class="error">${opts.error}</p>` : ""}
  <form method="post" action="/access">
    <label for="email">Work email</label>
    <input id="email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@company.com" required>
    <label for="use_case">What do you want to find out?</label>
    <textarea id="use_case" name="use_case" placeholder="e.g. We screen logistics sites in NRW and need to know who owns the neighboring parcels." required></textarea>
    <input class="trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <button type="submit">Request access</button>
  </form>
  <div class="note">Using the MCP server? Your agent can request access directly —
  the <code>request_access</code> tool takes an email and a use case, no browser needed.
  Endpoint: <code>https://1sensedata.com/mcp</code></div>`);
}

export function accessThanksPage(): string {
  return page(`
  <h1>Request received</h1>
  <div class="ok">
    <p>1Sense opens to a small group first. We will write to you when your
    access is ready.</p>
    <p>Until then, the open tools are live: parcel search, Bodenrichtwerte and
    the company register across Germany.</p>
  </div>`);
}
