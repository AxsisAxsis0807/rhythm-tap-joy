# Player avatar fix — verification and release gate

## Evidence
ProfileScreen used a public URL from the songs bucket without testing retrieval or decoding. The public URL method does not establish accessibility. The live bucket settings and the iPhone network response are not available in this review, so the precise original failure is not confirmed.

## Design
New uploads use the dedicated public player-avatars bucket (public profile images only, not songs). The browser decodes and center-crops to a PNG of at most 512px; selection previews locally. HEIC/HEIF only work if the browser can decode them. Saving verifies the public URL before committing the profile row; a failure leaves the saved URL unchanged. Profile, header and leaderboard fall back on errors. Existing URLs remain unchanged until the user chooses a replacement.

## Release gate (not performed here)
- Inspect actual production bucket settings, storage policies and original request status/content type using an authorized test account. Do not publish private song files or expose credentials.
- Apply the new SQL migration only with owner approval and verify owner-only insert, cross-user/anonymous insert denial, public retrieval, file restrictions, and unchanged songs/privacy settings.
- Run typecheck, complete tests, build, input regressions, changed-file lint and real Safari/iPhone + PC tests. Test select, cancel, invalid file, rapid selection, save success/failure/retry, reload, login, header and ranking. Verify account switch and storage errors. Existing broken images require re-selection if the original object is inaccessible.
- Client-side PNG conversion is not server-side byte verification. Do not enable wider public uploads without considering server-side validation, quota/rate limiting and abuse controls.
- Unique upload paths avoid overwrites and stale cache. Old/abandoned uploaded objects can remain; cleanup and deletion policy need a separate reviewed design. No automatic deletion, migration of old avatar objects, production deployment or DB changes are authorized by this patch.

## First CI audit findings (before follow-up)
- Full suite initially failed: existing FNF keyboard-resume test (not touched by avatar patch), and an assertion requiring every Storage bucket to be private (new public avatar bucket requires the security test to distinguish avatar assets from canonical private buckets).
- Original avatar unit tests passed. Typecheck, production build and triple input regression passed. Full lint includes unrelated pre-existing debt and is informational in the existing workflow; changed-file lint coverage needs dedicated verification.
