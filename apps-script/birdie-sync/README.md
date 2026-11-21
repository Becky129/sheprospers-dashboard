# Birdie Brain ⇄ Audit sync (Google Apps Script)

Keeps these two workbooks in sync:

| Source | Role | What the script does |
|---|---|---|
| **Birdie Brain \| AI Editing & Marketing Playbook \| Live** | Rules, recommendations, approvals | Hosts the script. Gets performance findings; sends approved knowledge out |
| **Becky in Midlife \| TikTok Growth & Content Audit \| Nov 2026** | Real performance data | Gets a script-owned `BIRDIE SYNC` tab plus approved experiments in `CREATIVE TESTS` |
| **October Creator Marketing Master Playbook** (Doc) | Reference | Read-only fingerprint. A change opens a review item |
| **November TikTok Master Reset** (Doc) | Reference | Read-only fingerprint. A change opens a review item |

The script reads all IDs from **AI CONTROL CENTER**. The IDs in `CONFIG.FALLBACK_IDS` are used only if those rows are blank.

## What moves where

**Audit ➜ Brain**
- `SYNC SNAPSHOTS`: one row each time a watched Audit tab changes. The script keeps a SHA-256 fingerprint of each tab, so unchanged tabs are skipped.
- `AI RECOMMENDATIONS` (status *Pending review*). Rule-based checks only:
  - follow rate below 1.0 per 1K views (latest SNAPSHOTS reading; POST LOG is used when a post has no snapshot)
  - a post with 1,000+ views but no follows recorded
  - 3-second retention below 70%
- `RESEARCH QUEUE`: finished CREATIVE TESTS and SHOP CREATIVE TESTS, waiting for a human to decide whether they become a rule (BR-11).
- `AI RECOMMENDATIONS › Decision / notes`: results Becky types in Audit › CREATIVE TESTS for `AUTO-` tests.
- `TODAY BRIEFING`: only rows starting with `Auto ·` are written. Manual rows are left alone.

**Brain ➜ Audit**
- `BIRDIE SYNC` tab (created automatically and overwritten on every run): Brand rules, Video editing rules, approved Approval Queue items and approved AI recommendations.
- `CREATIVE TESTS`: each AI recommendation whose Review status is set to **Approved** is added once as a *Planned* row. Turn this off with `CONFIG.APPEND_APPROVED_TO_CREATIVE_TESTS = false`.

**Never**
- The Google Docs are never written to.
- Becky's manual Audit tabs are never edited or deleted. The script only appends to CREATIVE TESTS.
- No recommendation becomes a rule automatically. No AI or paid API calls are made.

## Install (about 5 minutes)

1. Open **Birdie Brain** › **Extensions › Apps Script**.
2. Replace the contents of `Code.gs` with [`Code.gs`](./Code.gs).
3. *(Recommended)* Go to **Project Settings ⚙ › Show "appsscript.json" manifest file**. Open `appsscript.json` and paste the `oauthScopes` block from [`appsscript.json`](./appsscript.json). This keeps Docs and Drive access **read-only**. Set `timeZone` to your own time zone; the daily run uses it.
4. Save. In the function dropdown pick **`refreshBirdieBrain`** › **Run**.
5. Approve the Google permission prompt. Because the script is your own, Google may show *"Google hasn't verified this app"*: choose **Advanced › Go to project (unsafe)**.
6. The first run:
   - records a baseline for every tab and both Docs
   - creates `BIRDIE SYNC` in the Audit workbook
   - installs the daily trigger (about 6 am)
   - sets AI CONTROL CENTER › System status to **ACTIVE**
7. Reload Birdie Brain. A **Birdie Sync** menu appears with *Run sync now*, *Install / repair daily trigger* and *Turn off automatic sync*.

## Daily use

- In **AI RECOMMENDATIONS**, set *Review status* to `Approved`, `Rejected` or `Testing`. Only `Approved` is sent to the Audit workbook.
- In **APPROVAL QUEUE**, set *Status* to `Approved` to publish the change to `BIRDIE SYNC`.
- In the Audit workbook, record the results of `AUTO-…` tests in CREATIVE TESTS (*Result* / *Decision*). They show up in Birdie Brain after the next sync.
- If something fails, AI CONTROL CENTER › *Last error* and `CHANGE LOG` show what went wrong.

## Tuning

Edit `CONFIG` at the top of `Code.gs`:
- `DAILY_HOUR`
- `THRESHOLDS`
- `AUDIT_TABS_WATCHED`
