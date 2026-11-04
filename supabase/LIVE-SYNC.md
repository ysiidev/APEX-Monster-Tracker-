# Live app connection

The updated app connects directly to Supabase using the public publishable key in `desktop/app/cloud.js`. No service-role key is shipped. Migration `0002_live_sync.sql` was applied to the project on 2026-11-04.

## Email and tracker password

The sign-in panel accepts the username **admin** (or the owner email) plus a separate tracker password. The admin alias maps to the owner email for Supabase authentication; it is not a second account or a hard-coded password bypass. Never use your Google/Gmail password. No password is embedded in code or stored in localStorage.

For first-time setup, enter a new password of at least 12 characters and click **Create tracker account**. Open the confirmation email and confirm ownership, then return to the app and use **Sign in**. The confirmation link may redirect to the project's configured site URL (currently localhost); email verification happens before that redirect. Email delivery and the real owner login still require an owner smoke test.

The existing confirmed owner account was provisioned with the requested tracker password on 2026-11-04 through the authorized Supabase database connector. The bcrypt hash was verified without returning it. No password was saved in this repository. Existing owner: sign in using admin; no new registration or confirmation is needed. The actual browser password-token exchange still needs an owner smoke test because this sandbox cannot reach the Supabase REST host.

The email-link sign-in button, pasted-link/code field, Connect cloud button, and associated instructions have been removed. The UI now uses email/password login only.

The app now opens on a full-screen APEX Monster Tracker staff login modeled on the supplied reference. The tracker is hidden until Supabase sign-in succeeds, and Sign out returns to the login screen. This UI gate does not encrypt or remove the local file/browser cache; OS account protection is still required. The Forgot password control currently explains administrator-assisted reset through Supabase Auth; self-service recovery is not configured.

## Behavior

- Every connected edit is saved to Supabase before updating the local file/UI. Other connected devices poll every five seconds while visible.
- The live cloud source of truth is `public.tracker_live_state`, initially seeded from the latest archived snapshot (10 sales). Whole-document saves use a revision comparison in an owner-only RPC. Concurrent edits fail rather than overwrite newer data; wait for refresh and retry.
- Network failures reject connected edits with a visible error. There is no offline upload queue. Signing out hides the tracker; signing in loads cloud state and does **not** merge older local changes.
- Local restore is blocked while connected. Disconnect before restoring. Reconnecting will still load cloud state, not upload the restored file.
- Sessions and refresh tokens are kept only in memory. Reopening the app requires sign-in again. Sign out forgets the in-memory session but keeps the local data copy. This is not a local screen lock; secure your PC/browser profile.
- The existing normalized tables, reporting views, CLI sync, and scheduled PowerShell backups remain a **separate legacy backup layer**. Live edits do not update those tables. Do not treat the legacy reporting views as current live data; the live JSON is the source of truth. Existing backup uploads do not overwrite live state.
- Existing installed EXE/MSI versions are unchanged until rebuilt/reinstalled with these app assets.

## Security and tests

RLS allows reads only for authenticated JWTs matching the owner email. Direct client inserts, updates, and deletes are revoked. The security-definer RPC independently checks the owner and performs a conditional atomic save. Anonymous users have no read policy or save permission. Do not add public policies to the legacy financial tables.

Run `node preview/check-cloud.js` from `APEX-Tracker-Continuation/desktop` for mocked authentication, local backup, successful save, conflict rejection, offline rejection, restore protection, and disconnect checks. Also run the existing preview checks and `node tools/sync-selftest.mjs` from the root. This sandbox cannot reach the project's REST host directly, so real browser email verification and REST behavior still require an owner smoke test. Live schema/grants were inspected through the Supabase connector.

## Approved motion release (v1.0.3)

The standalone SVG motion study was approved and integrated into the real app. `motion.css` covers the login, module navigation, cards, lists, and chart bars. `motion.js` animates numeric updates without changing their exact text or financial values. Both respect the OS reduced-motion preference, including cancelling active numeric animations when that preference changes. Custom SVG linework replaces the home logo; no emoji/sticker assets or demo dashboard data are included. Both installers explicitly package these files. Run `node preview/check-motion.js` to check value preservation, reduced-motion behavior, and packaging manifests.
