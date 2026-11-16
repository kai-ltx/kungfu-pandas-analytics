# Apps Script deployments

Checked 12 November 2026 against the live project, before the V4 release. The table shows the state before release. The V4 release section below has the current versions. The GitHub webhook secret was not read.

The local project is bound to the existing script (ID begins `14BoR7`).

| Prefix | Version | Description | Access | Runs as | What a push does |
|---|---|---|---|---|---|
| `AKfycbw0HTqAppZ3` | 8 | Dashboard_V3.2 | Anyone, including anonymous | The script owner | Nothing. This is a saved snapshot. |
| `AKfycbxlZ6HiZObu` | 5 | (none) | Anyone, including anonymous | The script owner | Nothing. This is a saved snapshot. Matches the webhook prefix from the original setup. |
| `AKfycbzVvMEVHG52` | HEAD (no version number) | (none) | Anyone, including anonymous | The script owner | Serves the newly pushed code. |

Versions on the project: 1–5 have no description, 6 is Dashboard_V2, 7 is Dashboard_V3, 8 is Dashboard_V3.2.

## Head deployment

Google's deployment record says the head deployment is a web app open to anyone, including people who are not signed in, and it runs as the owner. Its update time is the Unix epoch, which is how Apps Script marks the default head deployment.

An unauthenticated request was not given the dashboard. It was redirected to Google's sign-in page. That does not remove the "anyone" access setting. A browser that completes Google's redirect can still be allowed in.

Nothing in this repository points at the head deployment. The GitHub Actions workflow uses the `GOOGLE_WEBHOOK_URL` secret. That secret was not read, so it is not proven that the webhook still points at version 5.

## V4 release, 12 November 2026

Approved for production and released from commit `e07634a`, which is byte-identical to test version 2 apart from the test spreadsheet guard.

| Prefix | Before | After | Description |
|---|---|---|---|
| `AKfycbxlZ6HiZObu` (webhook) | 5 | 9 | PandaMetrics V4 webhook (rollback: v5) |
| `AKfycbw0HTqAppZ3` (dashboard) | 8 | 9 | PandaMetrics V4 dashboard (rollback: v8) |
| `AKfycbzVvMEVHG52` (head) | V3.2 code | V4 code | Follows every push |

Version 9 is `PandaMetrics V4`. Both URLs are unchanged. The manifest and OAuth scopes are unchanged, so no re-authorisation was needed.

Before the push, production was last modified at 02:41 UTC. The `PandaMetrics V4 - TEST` copy was made from it at 11:58 UTC and is the data backup, together with the production file's version history. The Apps Script source at head, version 5 and version 8 was saved locally under `build/prod-backup/`, which is gitignored.

Checks after release: the dashboard loads anonymously with the V4 sections, and an unauthenticated webhook post returns `Unauthorized` without writing.

All three deployments serve the same `Code.js`, so the importer reaches the V4 webhook whichever URL the `GOOGLE_WEBHOOK_URL` secret holds. The secret was not read.

### Rollback

Run these from `apps-script/`. Neither needs a push, and no data is deleted. Get the full ids from `clasp deployments`. They are not written here because the webhook URL is a secret.

```
clasp redeploy <webhook id, AKfycbxlZ6HiZObu…> -V 5 -d "Rollback to v5"
clasp redeploy <dashboard id, AKfycbw0HTqAppZ3…> -V 8 -d "Rollback to Dashboard_V3.2"
```

To return head to V3.2, push the saved `build/prod-backup/8/` sources. Then revert `main` to `5bad9e7` so the V3 importer runs again. Rows written by V4 keep text match ids and extra columns, and the V3 dashboard reads them (covered by `tests/js/history.test.js`).

## V4.1 release, 16 November 2026

Approved for production and released from commit `8e7017b` (`feature/v4.1-clubhouse`, fast-forwarded into `main`), the same code as test version 3 apart from the test spreadsheet guard.

| Prefix | Before | After | Description |
|---|---|---|---|
| `AKfycbxlZ6HiZObu` (webhook) | 9 | 14 | PandaMetrics V4.1 webhook (rollback: v9) |
| `AKfycbw0HTqAppZ3` (dashboard) | 13 | 14 | PandaMetrics V4.1 dashboard (rollback: v13) |
| `AKfycbzVvMEVHG52` (head) | V4 code | V4.1 code | Follows every push |

The manifest and OAuth scopes are unchanged. The webhook now completes rows whose event log was cut short (`eventCoverage` incomplete or missing) when a complete copy arrives; complete and legacy rows are never rewritten. The workflow adds a second run at minute 37 of each evening hour.

Checks after release: the dashboard loads anonymously with the V4.1 header, and a manual importer run on `main` succeeded for all three clubs with no duplicate rows.

Rollback, from `apps-script/`:

```
clasp redeploy <webhook id, AKfycbxlZ6HiZObu…> -V 9 -d "Rollback to V4 webhook"
clasp redeploy <dashboard id, AKfycbw0HTqAppZ3…> -V 13 -d "Rollback to V4 dashboard"
```

Then revert `main` to `3be3f10` so the V4 importer and schedule run again. Rows upgraded by V4.1 keep the same columns and stay readable by V4.

## Isolated test environment

Created 12 November 2026. Production deployments above were listed again after this and were unchanged.

| | |
|---|---|
| Spreadsheet | `PandaMetrics V4 - TEST`, a copy of the production sheet. Not shared. Id is in `config/test.local.json` only. |
| Apps Script | `PandaMetrics V4 - TEST`, container-bound to that copy. Script id begins `10sn8D`. Not the production project. |
| Local project | `build/test/` with its own `.clasp.json`. Both are gitignored. `clasp push` and `clasp deploy` for the test must use `--project build/test/.clasp.json`. |
| Deployment | Version 2, description `PandaMetrics V4 TEST`. Web app, anyone including anonymous, runs as the owner. Id begins `AKfycbxAnvh8ND`. The same URL as version 1. |
| Scope | `spreadsheets.currentonly` only. The build contains no production spreadsheet id and no `openById`. |
| Webhook | No `WEBHOOK_TOKEN` is set. `doPost` rejects every request. |

The owning Google account authorised the test web app on 12 November 2026.

Source for version behaviour: [Apps Script deployments](https://developers.google.com/apps-script/concepts/deployments). A numbered version keeps serving its snapshot. A head deployment serves the latest saved code.
