# PandaMetrics — Security Notes

**Branch:** `feature/pandametrics-v4` · Nothing here is deployed yet. Production still runs the V3.1 code cloned on 12 Nov 2026.

## 1. Deployment model and why it matters

`appsscript.json` deploys the web app with `executeAs: USER_DEPLOYING` and `access: ANYONE_ANONYMOUS`. Every request runs **as the owner, with the owner's Google permissions**, and needs no sign-in.

The dashboard page talks to the server with `google.script.run`. Google's documentation says **any top-level server function whose name does not end in `_` can be called from the browser**, whether or not the page uses it ([Apps Script: HTML service — private functions](https://developers.google.com/apps-script/guides/html/communication#private_functions)). So anyone with the dashboard link could open the browser console and call those functions with arguments of their choosing.

## 2. What was exposed in production (V3.1)

| Function (production name) | File | What an anonymous caller could do | Severity | Identifier |
|---|---|---|---|---|
| `migrateExistingClubData()` | `Code.js` | **Write to the production spreadsheet as the owner**: add `clubId`/`clubName` columns if missing and fill blank cells with KungFu Pandas defaults. Re-running is mostly idempotent, but it could mislabel rows imported without a club id and adds writes and lock contention. | High | CWE-749 (exposed dangerous method), CWE-284, OWASP A01:2021 Broken Access Control |
| `testSpreadsheetAccess()` | `Code.js` | Open the spreadsheet as the owner and log its name to the owner's execution log. It leaked nothing to the caller, but it was an unauthenticated owner-privileged action. | Low | CWE-749 |
| `saveRecords(ss, sheetName, records, keyFields)` | `Code.js` | Callable, but `google.script.run` can only pass plain data, so `ss` can't be a real Spreadsheet and the call fails. No practical access. | Informational | CWE-749 |
| `jsonResponse(data)` | `Code.js` | Returns a text output; no data access. | Informational | — |
| `getDashboardData()` | `Dashboard.js` | Intended public. It returned **every raw stat and each player's EA `playerId`** (a persistent account identifier) to anyone with the link. | Medium | CWE-359 (exposure of private personal information), OWASP API3:2023 Broken Object Property Level Authorization |
| `doPost(e)` | `Code.js` | Intended public (the GitHub webhook). Protected by `WEBHOOK_TOKEN` from Script Properties. | — (token-protected) | — |
| `doGet()` | `Dashboard.js` | Intended public (serves the page). | — | — |

## 3. What the V4 branch changes

| Protection | How | Verified by |
|---|---|---|
| **Private helpers** | Renamed to `migrateExistingClubData_`, `testSpreadsheetAccess_`, `saveRecords_`, `jsonResponse_`. All new helpers end in `_` (`logSync_`, `invalidateDashboardCache_`, `include_`, `panda*_`). | `tests/js/security.test.js`: fails if any top-level function outside `{doGet, doPost, getDashboardData}` lacks a trailing `_`. |
| **Minimal dashboard data** | `getDashboardData` returns display fields only. EA player ids become opaque `p1…pN`, and raw event strings and sheet-only columns are dropped. | `tests/js/history.test.js`: "V4 dashboard reads mixed V2 + V4 rows without exposing EA player ids". |
| **No client code on the server** | `Insights.js` and `App.js` live in `client/` and are inlined into `ClientLib.html`, so they are never server functions and are never evaluated by `doPost`. | Security test "browser-only view code is never a server file". |
| **Output encoding** | Every interpolated value in `App.js` goes through `esc()` (CWE-79). No `eval`, `new Function`, `document.write` or third-party scripts. | Insights test "client UI avoids dangerous sinks"; the bundler rejects `</script` in sources. |
| **Generic errors** | `getDashboardData` returns a fixed message on failure; details go to the owner's log only (CWE-209). | Code review. |
| **Webhook log integrity** | Sync_Log is written only after the token check, so anonymous callers can't write to the log. Failures of authorised calls are now logged with `Status = error: …` (closes B16). | History test "failed authorised imports are logged; unauthorised ones are not". |
| **Read amplification** | Dashboard data is cached for 5 minutes in `CacheService` (chunked under the 100 KB limit) and cleared after each import. Repeated page loads or Refresh clicks read the cache, not the sheet. | History test "dashboard cache is chunked and invalidated by new imports". |
| **CI supply chain** | Actions pinned to full commit SHAs (closes S5). Workflow token is `contents: read` with `persist-credentials: false`. Python dependencies are pinned. | Security test "GitHub Actions are pinned to full commit SHAs". Source: [GitHub — security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions). |

**Residual risks (accepted or open):**
- **S7 (CWE-208):** the token comparison is not constant-time. Exploiting it is impractical over Apps Script's network jitter, so this is accepted.
- **S8 (CWE-770 / CWE-294):** the webhook has no rate limit or HMAC. A leaked token allows unlimited (deduplicated) writes; rotate it if exposed.
- **Disclosure caveat:** the old functions stay callable in production until V4 is deployed.

## 4. "Sync Now": preventing anonymous abuse

### Current V4 behaviour

There is **no Sync Now in the V4 dashboard**. The **Refresh stats** button only calls `getDashboardData`, which is read-only and served from the 5-minute cache. Spamming it can't trigger an EA fetch, a GitHub run or a sheet write.

### Why a public Sync button is unsafe

A real sync needs a GitHub token able to dispatch the workflow.
- In an anonymous, execute-as-owner web app, Apps Script can't tell visitors apart: `Session.getActiveUser().getEmail()` returns an empty string for anonymous and external users ([Apps Script: Session.getActiveUser](https://developers.google.com/apps-script/reference/base/session#getActiveUser())).
- Hiding the button for non-admins is not authorisation, because the server function would still be callable from the console (CWE-862 Missing Authorization, OWASP A01:2021).
- Each call would consume GitHub Actions minutes and EA API requests (CWE-770 Allocation of Resources Without Limits or Throttling).

### Recommended design (not implemented, awaiting approval)

1. **Preferred, no code:** admins use GitHub's **Run workflow** button (`workflow_dispatch` is already enabled). GitHub authenticates the user and checks repository permissions.
2. **If an in-dashboard button is wanted:** add `requestSync()` with these server-side checks:
   - **Who:** `Session.getActiveUser().getEmail()` must be in an allowlist stored in Script Properties. Anonymous visitors get `""` and are denied. This only works for accounts that can be identified, typically the owner, so in practice it is **admin-only**.
   - **How often:** a global cooldown (for example 10 minutes) in `CacheService`, plus `LockService` to stop parallel dispatches.
   - **What with:** a fine-grained GitHub token limited to **Actions: write on this one repository**, stored only in Script Properties and never sent to the browser.
   - **What it does:** calls GitHub's workflow-dispatch API ([GitHub REST: create a workflow dispatch event](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)) and returns only "queued", "cooling down" or "not allowed".
   - **Tests:** anonymous caller denied, non-allowlisted caller denied, cooldown honoured, token never in the response.
3. Letting teammates sync from the dashboard would require a non-anonymous deployment where they sign in with Google. That changes how everyone opens the dashboard, so it's your call.
