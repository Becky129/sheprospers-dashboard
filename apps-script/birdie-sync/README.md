# Birdie Brain ⇄ Audit sync (Google Apps Script) — v2

Keeps two Google Sheets in sync and watches two reference Docs:

| Source | Role | What the script does |
|---|---|---|
| **Birdie Brain \| AI Editing & Marketing Playbook \| Live** | Rules, recommendations, approvals | Hosts the script. Gets performance findings and Audit knowledge; sends approved knowledge out |
| **Becky in Midlife \| TikTok Growth & Content Audit \| Nov 2026** | Real performance data | Gets one script-owned tab (BIRDIE SYNC), plus approved experiments appended to CREATIVE TESTS |
| **October Creator Marketing Master Playbook** (Doc) | Reference, read-only | Fingerprinted. A change opens a review item |
| **November TikTok Master Reset** (Doc) | Reference, read-only | Fingerprinted. A change opens a review item |

The script reads all four IDs from **AI CONTROL CENTER** (`Audit workbook ID`, `Brain workbook ID`, `October playbook document ID`, `November reset document ID`). The IDs in `CONFIG.FALLBACK_IDS` are used only if those cells are blank.

## Schedule

- Runs once a day at about **8:00 a.m. Eastern** (Google runs it between 8:00 and 9:00).
- The trigger is pinned to `America/New_York`, so it stays at 8 a.m. Eastern whatever the project's time zone. The manifest uses the same zone, so the times shown in the script editor match.
- There is always **exactly one** sync trigger. Every run checks this and repairs it if there are none, duplicates, or an old schedule (for example the 6 a.m. trigger from v1).
- **Birdie Sync › Turn off automatic sync** removes only this script's sync trigger. Other triggers in the project are not touched.

## What moves where

**Audit ➜ Brain**
- `AI RECOMMENDATIONS` (status *Pending review*). Rule-based checks only:
  - follow rate below 1.0 per 1K views, using the **latest dated reading** per post in SNAPSHOTS (by Date + Time, or Posted date + Hours after post; never by row position). POST LOG is used only for logged posts that have no snapshot.
  - a logged post (one with a *Posted date*) with 1,000+ views but no follows recorded. The ~500 historical grid rows (G001…) have no posted date and are never flagged.
  - 3-second retention below 70%
  - an AUDIENCE reading below target: female < 70%, age 45+ < 60% or US < 80%
- `RESEARCH QUEUE`: finished CREATIVE TESTS and SHOP CREATIVE TESTS, waiting for you to decide whether they become a rule (BR-11). A change to either reference Doc also lands here.
- `AI RECOMMENDATIONS › Decision / notes`: results you type in Audit › CREATIVE TESTS for `AUTO-` tests.
- `AUDIT KNOWLEDGE` (script-owned tab): a read-only copy of VISUAL STYLE GUIDE, CREATOR TRAINING LAB, VIDEO PRODUCTION SPECS, SEO & HOOKS, COMMENT INSIGHTS and INSPIRATION BANK. It's rebuilt whenever one of those tabs changes.
- `APPROVAL QUEUE` (*Pending review*): each **new** row in INSPIRATION BANK, CREATOR TRAINING LAB or VISUAL STYLE GUIDE becomes a `KNOW-…` proposal. The 70 rows that exist at the first sync are treated as already seen. To queue them too, set `QUEUE_EXISTING_KNOWLEDGE_ON_FIRST_SYNC: true` before the first run.
- `VIDEO EDITING RULES`: a `KNOW-…` proposal whose Status is **Approved** is added here once, under its Audit ID (e.g. `TR-15`). Existing rules are never changed.
- `SOURCE INDEX`: START HERE, DASHBOARD, MIRROR & FUNNELS, MARKETING FUNNELS and YAPPING 10-DAY PLAN are listed once, with links. They're for reference only.
- `TODAY BRIEFING`: see *Manual content* below.

**Brain ➜ Audit**
- `BIRDIE SYNC` (script-owned tab): Brand rules, Video editing rules, approved Approval Queue items and approved AI recommendations. Rebuilt on every run.
- `CREATIVE TESTS`: each AI recommendation whose Review status is **Approved** is **appended** once as a *Planned* row (`AUTO-…`). Existing rows are never edited. Turn this off with `CONFIG.APPEND_APPROVED_TO_CREATIVE_TESTS = false`.

## TikTok Shop period in the briefing

`Auto · Latest TikTok Shop period` is picked from SHOP KPI BASELINE **by date, not by row position**:
- A row counts only if:
  - its *Scope* is `TikTok Shop affiliate` (`CONFIG.SHOP_PERIOD_SCOPES`)
  - its *Period / date* is a date range, like `2026-11-01 to 11-17`
  - at least one of GMV, attributed items, product clicks or est. commission is filled in

  Audience, content-performance, PPS, listing and brand-brief rows are ignored. That includes the grace & stella `$2.84` per-sale listing price, which is not a payout.
- The latest end date wins. If two periods end on the same day, the longer one wins because it is more complete.
- A blank cell shows as **not recorded**, never as 0. A 0 you typed shows as 0.
- GMV is labeled *sales value, not earnings*. Shop commission and Creator Rewards (WEEKLY REVIEW › Estimated rewards) are shown separately and never added together.

## Approvals: only the exact word "Approved" counts

- `AI RECOMMENDATIONS › Review status` and `APPROVAL QUEUE › Status` must be exactly **Approved** (any capitalization).
- *Pending review*, *Proposed*, *Testing*, *Rejected* or "Approved — maybe later" are **never** pushed or promoted.
- *Waiting for review* in the briefing counts every row that isn't Approved, Rejected, Testing, Tested, Done, Complete, Closed or Archived.

## Reliability

- **Two-phase sync.** Each run first *detects* what changed, then processes it, and only at the very end *commits* (saves fingerprints, writes SYNC SNAPSHOTS). If anything fails, nothing is committed. The changed tabs stay pending and are redone on the next run.
- **No duplicates on retry.** Every row the script adds has a stable ID that it checks before adding:
  - `AUTO-…` recommendations
  - `KNOW-…` proposals
  - `sync-key:` tags on research items
  - Audit IDs on rules and `AUTO-…` IDs in CREATIVE TESTS
- **Errors stay visible.**
  - **On failure:** AI CONTROL CENTER shows *System status* `ERROR`, and *Last error* holds the message plus the list of pending tabs. CHANGE LOG gets a `FAILED` row with the full error.
  - **After the next successful run:** *Last error* is cleared and its status reads *Resolved [time] (details in CHANGE LOG)*.
- **Header check.** Every run checks that the columns the script uses still exist. A missing column in an Audit tab skips that tab (it is not reported as synced), logs a warning and sets *System status* to `ACTIVE — WARNINGS`. A missing column in Birdie Brain stops the run before anything is written.
- **Script-owned tabs only.** BIRDIE SYNC and AUDIT KNOWLEDGE are rebuilt only if cell A1 holds the script's marker text. If you ever make your own tab with one of those names, the script leaves it alone and logs a warning.
- **Manual content.** In TODAY BRIEFING the script writes only rows whose column A starts with `Auto · `, and only columns A:B of those rows. It never writes B1 or any row you typed. New Auto rows go below the last used row, and the script refuses to write over a row that isn't an Auto row. The sync time is in `Auto · Last sync`. Your B1 text ("automation not yet activated") is yours to update once the script is running.
- **Data checks.** `Auto · Data checks` reports SNAPSHOTS rows with no usable date/time and duplicate timestamps. For a duplicate, the lower row is used, as a correction.

## Permissions

| Scope | Why |
|---|---|
| `spreadsheets` | Read both workbooks; write Birdie Brain and the Audit's BIRDIE SYNC / appended CREATIVE TESTS rows. Google has no narrower scope that can open a second workbook by ID. |
| `documents.readonly` | Read the two reference Docs (never written) |
| `drive.readonly` | Read each Doc's "last edited" time |
| `script.scriptapp` | Create/remove the daily trigger |
| `script.container.ui` | Show the Birdie Sync menu |

The script has no external API calls, no OpenAI key and no paid services. *AI analysis mode* stays OFF.

## Install or upgrade (about 5 minutes)

1. Open **Birdie Brain** › **Extensions › Apps Script**.
2. Select everything in `Code.gs`, delete it, and paste in [Code.gs](./Code.gs).
3. Click **Project Settings ⚙**, tick **Show "appsscript.json" manifest file in editor**, go back to the editor, open `appsscript.json`, and replace its contents with [appsscript.json](./appsscript.json). This sets the Eastern time zone and keeps Docs/Drive access read-only.
4. Click **Save**. In the function dropdown pick **refreshBirdieBrain** › **Run**.
5. Approve the Google permission prompt. Google may show *"Google hasn't verified this app"* because the script is your own: choose **Advanced › Go to (project name)**.
6. Check that the first run worked:
   - AI CONTROL CENTER › *System status* = `ACTIVE`; *Refresh frequency* = `Daily ~8:00 a.m. Eastern`
   - CHANGE LOG has a `refresh … OK` row
   - The Audit workbook has a **BIRDIE SYNC** tab; Birdie Brain has **AUDIT KNOWLEDGE**
   - In Apps Script, **Triggers** (clock icon) shows exactly one `refreshBirdieBrain` trigger, *Day timer, 8am to 9am*
7. Reload Birdie Brain. A **Birdie Sync** menu appears: *Run sync now*, *Install / repair daily trigger*, *Turn off automatic sync*.

**What to expect from the first run on today's data:**
- Two follow-rate recommendations: P001 at 0.94/1K (58.5K views, Nov 16 08:02) and P002 at 0.48/1K
- One research item for test T001
- A baseline row in SYNC SNAPSHOTS for each watched tab and both Docs
- No approval-queue items (the existing knowledge rows are baselined)

## Daily use

- **AI RECOMMENDATIONS:** set *Review status* to `Approved`, `Testing` or `Rejected`. Only `Approved` goes to the Audit workbook.
- **APPROVAL QUEUE:** set *Status* to `Approved` to add a knowledge proposal to VIDEO EDITING RULES and BIRDIE SYNC.
- **Audit › CREATIVE TESTS:** fill in *Result* / *Decision* for `AUTO-…` tests. They show up in Birdie Brain after the next sync.
- **If something fails:** check AI CONTROL CENTER › *Last error* and CHANGE LOG. Fix the cause and run **Birdie Sync › Run sync now**. Pending work is redone without duplicates.

## Tuning (top of Code.gs)

- `TIMEZONE`, `DAILY_HOUR`
- `THRESHOLDS` (follow rate, retention, audience targets)
- `SHOP_PERIOD_SCOPES`
- `KNOWLEDGE_TABS`, `PROPOSE_FROM_TABS`, `REFERENCE_ONLY_TABS`, `AUDIT_TABS_WATCHED`
- `REQUIRED_HEADERS`: update this if you rename a column the script uses
