# Technical upgrade: first local batch

Started 10 October; checked again 11 October 2026. Local changes only. No deployment, database migration, real
email, account creation or payment occurred. The shared progress ledger lives
in EthosVault at `wiki/analyses/2026-09-19-ethos-technical-upgrade-execution-record.md`.

## Setup and checks

Use Node 24 (`.nvmrc` and `package.json`). The first check used Node 24.19.0 and
npm 10.8.2. From this application directory:

```sh
npm ci --ignore-scripts
npm test
npm run check:imports
npm run build
```

Tests use synthetic identities, mocked database calls and captured email payloads.
They do not require runtime credentials. Module imports do not invoke handlers.
For this batch, tests/imports/build ran in a disposable copy under a macOS
network-disabled sandbox, with an empty allowlisted environment, restricted
filesystem access, no child-process creation, CPU/file limits, a bounded V8 heap
and parent memory/time/disk watchdog. macOS rejected hard RSS/address-space limits;
the parent watchdog supplies that bound. The runner and results are outside the
application in `../upgrade-evidence/2026-10-10-start/`.

## Changes and remaining acceptance

- Locked the existing dependency ranges and declared Node 24. Replaced the
  undeclared Resend SDK use in signup with a small HTTP helper. Clean installation
  with lifecycle scripts disabled passed. npm audit reported zero advisories for
  resolved production dependencies on this date; this does not cover browser CDNs.
- Added Git/CLI-upload exclusions. The build copies only
  `scripts/public-files.json` into `dist`; new assets require an explicit manifest
  entry. Four unlaunched offer pages and two newer legal draft templates are excluded. Legal aliases retain the deployed interim portal notices until approved publication; no draft is promoted to approved policy. `api/` and `lib/` remain server
  build inputs and are not copied to static output. Vercel is configured to run
  the build and serve `dist`; deployment root is now captured in provider metadata. Actual function packaging still
  requires build verification before release. Do not deploy the parent folder.
- Recovery cron returns 503 when required configuration is absent and 401 when
  the bearer is wrong, before touching the database or email service. Durable job
  claims, recipient eligibility, complete suppression queries and retry handling
  remain open.
- Enquiry list/detail fallbacks, enquiry/invoice/recovery emails and unsubscribe
  output escape untrusted HTML. Unsubscribe rejects malformed query types and
  token encodings. Existing signing-key derivation remains unchanged; dedicated
  signing-key migration and one-click unsubscribe semantics remain open.
- Document actions, revoke dialogs and bin labels pass strings through JSON data
  attributes and an explicit registered-handler map. Toast messages use
  `textContent`. Other inline handlers remain; this is not full CSP readiness.

## Release gates still open

- Fresh provider credential inventory closure and old Supabase key disposition.
- Effective schema/grants/triggers, recovery position and safe rollback target.
  Deployed revision and project root/runtime metadata were captured on 11 October; refresh before release.
- Isolated Supabase/Stripe/email services; do not use existing Preview/Development
  values until their separation from Production is verified.
- Profile authority, purchase ownership, persisted notification authorisation,
  direct enquiry bypass and other database-dependent work.
- Browser interaction checks for changed portal controls and local Vercel build
  verification, including server helper inclusion and negative static paths.
- Production authorisation followed by live readback. Local tests do not close
  deployment findings.

## Configuration references

- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20

## Provider baseline readback (11 October)

Authenticated read-only metadata identifies production `14dd6ab`, remote main
`38b9847` and local HEAD `1ce428e` plus this patch. The application root is the
repository root; Node 24 was already configured in Vercel. Ten environment
variable definitions cover production, preview and development together. No
runtime values were saved. These scopes are not accepted as isolated test services.
The local artifact now has 34 files; six unpublished draft HTML files are excluded.
Current verification: 24 tests, API imports and public build pass. No production
release or safe rollback target has been certified.

## Packaging and browser check (11 October, Claude)

Ran in a disposable copy of this working tree, with no `.env`, Git or `.vercel` data. Tools: Node 24.19.0, npm 10.8.2, and an offline `vercel build` (CLI 52.0.0) using a synthetic project file and no environment pull.

- **Local checks:** 24/24 tests, imports and a 34-file build pass.
- **Functions:** all 15 use `nodejs24.x`, and each bundle contains the `lib/` helpers and packages its handler requires. The cron is kept.
- **Static output:** exactly the manifest. Every rewrite target is present. SQL, `lib/`, `api/` source, package files, notes and drafts are absent.
- **Browser check:** a localhost harness in the built-in browser served the built `actions.js` and `portal.js`. Real clicks passed hostile synthetic filenames and names through unchanged. Unregistered or malformed actions were ignored, failures showed a generic toast, toast markup rendered as text, and nothing was injected or executed.
- **Not covered:** full portal pages with authenticated data, which need isolated services. Security headers are not configured.

Evidence: `../upgrade-evidence/2026-10-11-packaging-browser/`.

## Security release 1: database and enquiry route (11 October, Claude)

The database fixes are written as migration files. They have been tested only on the isolated replica project `ethos-upgrade-test` (`gmryfikamkedmmjkdtbs`) and are not applied live.

- **`supabase-security-release1.sql`** (rollback in `supabase-security-release1-rollback.sql`): clients can change only their name, company and notification settings; complete their own action items; and mark admin messages read. Message `id`, `created_at` and `is_read` are server-owned. Message size and rate are bounded. Attached documents must belong to the sender. Enquiries are bounded with server-owned status and dates. Admins and the service role are unaffected. Verified by 42 synthetic role checks; the rollback restores the live catalog exactly.
- **`api/submit-enquiry.js`** with `lib/enquiry.js`: validates the enquiry, applies durable per-email and site-wide limits, saves it, then notifies. `api/notify-enquiry.js` is retired (410). `app.js` forms show success only after a save. This also fixes the live contact form, which never saved enquiries.
- **`supabase-security-release1b-enquiry-cutover.sql`:** removes direct browser inserts into enquiries. Apply only after the app release is live.
- **`styles.css`:** `.booking-overlay[hidden] { display: none; }`. Without it, the unreleased booking modal leaves an invisible layer that blocks every click.
- **Release order:** deploy the app, apply release1, then apply release1b.

Checks: 31/31 tests, all imports, and a Vercel build with 16 Node 24 functions and 34 static files. A browser contact-form check against a stub API passed.

Evidence: `../upgrade-evidence/2026-10-11-release1-db/`.

## Security release 1: notifications and sign-up (11 October, Claude)

- **`api/send-notification.js` (P5):** the caller sends `{ event, clientId, ref }`, where `ref` is the message, document, action item or engagement id. The server checks the caller against the event matrix (client events come only from that client; admin events only from an admin). It loads the record, builds every email value from it with escaping and claims `(event, record)` in `notification_log` so each sends once. Uploads are debounced on the server for 30 minutes. The endpoint uses `SUPABASE_SECRET_KEY` and fails closed. Apply `supabase-security-release1c-notification-log.sql` first.
- **`api/free-audit-signup.js` and `portal/login.html` (P3):** there is no password at sign-up. Supabase emails an invitation and the password is set at `/portal/reset-password`. Existing addresses get the same response, nothing is created for them, and sign-ups are capped at 10 per hour.
- **`api/stripe-webhook.js` `findOrCreateClient` (P3):** normalises the email; fails safe on ambiguous or mismatched accounts; recovers an interrupted creation. Before binding to an unverified account, it replaces that account's password and sends the buyer a set-password link.
- **Release order:** release1, release1c, app deploy, then release1b.
- **Open before release:** check the Supabase Auth admin calls against the test project (mock-tested only), and review the Invite email template wording in Supabase.

Checks: 49/49 tests and a Vercel build (16 functions). A browser sign-up check against a stub passed. Evidence: `../upgrade-evidence/2026-10-11-release1-db/`.
