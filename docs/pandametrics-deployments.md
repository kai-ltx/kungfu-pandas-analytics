# Apps Script deployments

Checked 12 November 2026 against the live project. No deployment was updated, archived, or deleted. The GitHub webhook secret was not read.

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

## Decision

Do not `clasp push` this project. A push would not change versions 5 or 8, but it would change the public head deployment. That deployment runs as the owner against the production spreadsheet. Because its access is anonymous and the live webhook URL was not re-checked, pushing is not safe.

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

The test web app stays on a 403 Drive "You need access" page until the owning Google account opens the deployment URL once and grants the spreadsheets permission. That authorization has not been completed.

Source for version behaviour: [Apps Script deployments](https://developers.google.com/apps-script/concepts/deployments). A numbered version keeps serving its snapshot. A head deployment serves the latest saved code.
