/**
 * Birdie Brain ⇄ Becky in Midlife Audit — two-way sync          (v2, 2026-11-21)
 * ------------------------------------------------------------------------------
 * Install in: Birdie Brain | AI Editing & Marketing Playbook | Live
 *             (Extensions › Apps Script, paste this file as Code.gs)
 *
 * Each run (daily ~8:00 a.m. Eastern + "Birdie Sync" menu):
 *
 *   AUDIT ➜ BRAIN (performance facts)
 *     • Fingerprints each watched Audit tab; only changed tabs are processed.
 *     • Rule-based checks (follow rate, 3-sec retention, missing follows on
 *       logged posts, audience fit, finished tests) go to AI RECOMMENDATIONS /
 *       RESEARCH QUEUE as "Pending review". Nothing becomes a rule on its own.
 *     • Results Becky enters for AUTO- tests in Audit › CREATIVE TESTS are
 *       copied back to AI RECOMMENDATIONS › Decision / notes.
 *     • The six knowledge tabs are copied into Brain › AUDIT KNOWLEDGE. New
 *       Inspiration / Training / Visual rows are proposed in APPROVAL QUEUE.
 *     • Only "Auto ·" rows in TODAY BRIEFING are written. No other cell there
 *       is ever touched.
 *
 *   BRAIN ➜ AUDIT (approved knowledge)
 *     • Rebuilds one script-owned Audit tab, BIRDIE SYNC.
 *     • AI RECOMMENDATIONS whose Review status is exactly "Approved" are added
 *       once to Audit › CREATIVE TESTS as "Planned" rows.
 *
 *   REFERENCE DOCS: read-only fingerprints. A change opens a review item.
 *
 * RELIABILITY
 *     • Two-phase run: changes are DETECTED first, and fingerprints are only
 *       COMMITTED after every step succeeds. A failed run leaves the work
 *       pending, and the next run redoes it.
 *     • Every write is idempotent (keyed by a stable ID), so a retry never
 *       creates duplicates.
 *     • Header check: if a tab is missing a column the script needs, that
 *       tab is skipped, reported as a warning, and left pending (never
 *       reported as synced).
 *     • Script-owned tabs (BIRDIE SYNC, AUDIT KNOWLEDGE) are only rebuilt
 *       when cell A1 carries the script's marker.
 *
 * No AI, external API or paid service is used. AI analysis mode stays OFF.
 */

// ───────────────────────────── Configuration ─────────────────────────────

var CONFIG = {
  // Used only if the AI CONTROL CENTER rows are missing or blank.
  FALLBACK_IDS: {
    audit:  '11qhy5vJ8732VA6AXY4YrCUOKcclXO8Zud9RIpFpxi8Q',
    brain:  '177wB5MZCyMtZQ-UYrHvqsxglm_VwWcrp3C5jbOs-G9w',
    octDoc: '1RVMoOStHTsR1KDKqcoJZyonx9HJUZKDVoOJnwzRLsxo',
    novDoc: '1oYltsAM8yQcpzPY1tFSVl7zPgkQGtVvy93Oz9WwFxTE'
  },

  // Daily sync: ~8:00 a.m. Eastern (runs between 8:00 and 9:00).
  // The trigger is pinned to this zone, whatever the project's time zone.
  TIMEZONE: 'America/New_York',
  DAILY_HOUR: 8,

  // Audit tabs that are fingerprinted for changes.
  AUDIT_TABS_WATCHED: [
    'POST LOG', 'SNAPSHOTS', 'AUDIENCE', 'RETENTION', 'CREATIVE TESTS',
    'COMMENT INSIGHTS', 'WEEKLY REVIEW', 'SEO & HOOKS',
    'SHOP KPI BASELINE', 'SHOP VIDEO AUDIT', 'SHOP CREATIVE TESTS',
    'INSPIRATION BANK', 'VISUAL STYLE GUIDE', 'CREATOR TRAINING LAB', 'VIDEO PRODUCTION SPECS'
  ],

  // Audit tabs copied (read-only) into Birdie Brain › AUDIT KNOWLEDGE.
  KNOWLEDGE_TABS: [
    'VISUAL STYLE GUIDE', 'CREATOR TRAINING LAB', 'VIDEO PRODUCTION SPECS',
    'SEO & HOOKS', 'COMMENT INSIGHTS', 'INSPIRATION BANK'
  ],

  // New rows in these Audit tabs are proposed in APPROVAL QUEUE.
  // When approved, they're added to VIDEO EDITING RULES.
  PROPOSE_FROM_TABS: ['INSPIRATION BANK', 'CREATOR TRAINING LAB', 'VISUAL STYLE GUIDE'],

  // false = rows that already exist at the first sync are treated as seen (not queued).
  QUEUE_EXISTING_KNOWLEDGE_ON_FIRST_SYNC: false,

  // Audit tabs listed in SOURCE INDEX for reference only (not synced).
  REFERENCE_ONLY_TABS: {
    'START HERE': ['Definitions, follow-rate formula, which tab wins', 'When a definition or tab authority is unclear'],
    'DASHBOARD': ['Summary of POST LOG, SNAPSHOTS and WEEKLY REVIEW (not a source of truth)', 'Quick overview only'],
    'MIRROR & FUNNELS': ['Main funnel tab: stages, metrics, decision rules', 'Before judging a post by its funnel job'],
    'MARKETING FUNNELS': ['Summary of funnel models; defers to MIRROR & FUNNELS', 'Background reading'],
    'YAPPING 10-DAY PLAN': ['Short-term talking-video plan', 'While the 10-day plan is running']
  },

  // SHOP KPI BASELINE rows whose Scope is one of these (and whose
  // "Period / date" is a date range with at least one recorded KPI) count as
  // reporting periods. Audience, PPS, listing and brand-brief rows are ignored.
  SHOP_PERIOD_SCOPES: ['TikTok Shop affiliate'],

  // Script-owned tabs.
  MIRROR_TAB: 'BIRDIE SYNC',               // in the Audit workbook
  KNOWLEDGE_MIRROR_TAB: 'AUDIT KNOWLEDGE', // in Birdie Brain

  THRESHOLDS: {
    minViewsForRate: 1000,      // don't judge follow rate below this many views
    followsPer1kLow: 1.0,       // flag follow conversion below this
    threeSecRetentionLow: 0.70, // flag 3-sec retention below 70%
    audienceFemaleMin: 0.70,
    audience45PlusMin: 0.60,
    audienceUsMin: 0.80
  },

  APPEND_APPROVED_TO_CREATIVE_TESTS: true
};

var BRAIN = {
  CONTROL: 'AI CONTROL CENTER',
  BRAND: 'BRAND RULES',
  SOURCES: 'SOURCE INDEX',
  SNAPSHOTS: 'SYNC SNAPSHOTS',
  RECS: 'AI RECOMMENDATIONS',
  APPROVALS: 'APPROVAL QUEUE',
  LOG: 'CHANGE LOG',
  EDITING: 'VIDEO EDITING RULES',
  RESEARCH: 'RESEARCH QUEUE',
  BRIEFING: 'TODAY BRIEFING'
};

// Exact column names the script reads or writes. Checked on every run.
var REQUIRED_HEADERS = {
  brain: {
    'AI CONTROL CENTER': ['Key', 'Value', 'Status'],
    'BRAND RULES': ['Rule ID'],
    'SOURCE INDEX': ['Source ID', 'Type', 'Name', 'URL', 'Data authority', 'Read when'],
    'SYNC SNAPSHOTS': ['Synced at UTC', 'Source sheet', 'Row count', 'Digest SHA256', 'Latest sample / health', 'Notes'],
    'AI RECOMMENDATIONS': ['Created UTC', 'Proposal ID', 'Problem or observation', 'Recommended experiment', 'Evidence level', 'Source references', 'Success metric', 'Review status', 'Decision / notes'],
    'APPROVAL QUEUE': ['Created UTC', 'Proposal ID', 'Proposed change', 'Source / reasoning', 'Status', 'Reviewed by', 'Reviewed at', 'Notes'],
    'CHANGE LOG': ['Timestamp UTC', 'Operation', 'Target', 'Detail', 'Outcome', 'Error'],
    'VIDEO EDITING RULES': ['Rule ID', 'Task', 'Workflow', 'Evidence required', 'Avoid'],
    'RESEARCH QUEUE': ['Submitted UTC', 'Claim / source', 'Link', 'Reviewed date', 'Evidence class', 'Implications', 'Status', 'Notes']
  },
  audit: {
    'POST LOG': ['ID', 'Posted date', 'Time', 'Topic', 'Job', 'Views', 'Follows'],
    'SNAPSHOTS': ['ID', 'Date', 'Time', 'Hours after post', 'Views', 'Follows'],
    'AUDIENCE': ['ID', 'Snapshot', 'Female', '45–54', '55+', '45+ total', 'USA', 'Non-followers'],
    'RETENTION': ['ID', 'Snapshot', '3-sec retention', 'Largest drop'],
    'CREATIVE TESTS': ['Test', 'Date', 'Hypothesis', 'Primary measure', 'Benchmark', 'Result', 'Decision', 'Next action'],
    'SHOP CREATIVE TESTS': ['ID', 'Category', 'Evidence / claim', 'Status'],
    'SHOP KPI BASELINE': ['Period / date', 'Scope', 'GMV USD', 'Attributed items', 'Product clicks', 'Est. commission USD', 'Product card CTR', 'Evidence label'],
    'WEEKLY REVIEW': ['Window', 'Views', 'Profile views', 'Shares', 'Estimated rewards', 'FYP', 'Search', 'Lesson / next decision'],
    'INSPIRATION BANK': ['ID', 'Theme / territory', 'Why it caught attention', 'Hook / psychology', 'Audience mirror', 'Original Becky direction (idea only)', 'Content pillar', 'Source attribution', 'Status'],
    'CREATOR TRAINING LAB': ['ID', 'Category', 'Rule / learning', 'Observed evidence', 'Becky application', 'Execution standard', 'Test / measurement', 'Status', 'Source / reference'],
    'VISUAL STYLE GUIDE': ['Style ID', 'Style element', 'Color name', 'Approx. HEX', 'Source image', 'Visual treatment', 'Best use', 'Contrast / readability', 'Brand guidance', 'Status']
  }
};

var AUTO_PREFIX = 'Auto · ';
var PUSHED_NEXT_ACTION = 'Record result here; it syncs back to Birdie Brain';
var MIRROR_MARKER = 'BIRDIE SYNC — written by the Birdie Brain Apps Script';
var KNOWLEDGE_MARKER = 'AUDIT KNOWLEDGE — copied from the Audit workbook by the Birdie Brain Apps Script';
var NOT_RECORDED = 'not recorded';
// Review statuses that mean "decided" (anything else counts as waiting for review).
var DECIDED_STATUS = /^(approved|rejected|testing|tested|done|complete|completed|closed|archived)\b/i;

// ───────────────────────────── Entry points ──────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Birdie Sync')
    .addItem('Run sync now', 'refreshBirdieBrain')
    .addItem('Install / repair daily trigger', 'installBirdieTrigger')
    .addItem('Turn off automatic sync', 'turnOffBirdieSync')
    .addToUi();
}

/**
 * Main job. Run once by hand to authorize; that first run also installs the
 * daily trigger (exactly one) if it is missing or out of date.
 */
function refreshBirdieBrain() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('Another sync is already running; skipping.');
    return;
  }
  var brain = getBrain_();
  var ctx = null;
  try {
    var ids = readIds_(brain);
    ctx = {
      brain: brain,
      audit: SpreadsheetApp.openById(ids.audit),
      ids: ids,
      now: nowUtc_(),
      today: Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd'),
      props: PropertiesService.getScriptProperties(),
      pendingProps: {},      // committed only after every step succeeds
      pendingSnapRows: [],   // SYNC SNAPSHOTS rows, written at commit
      warnings: [],
      blockedTabs: {},       // tab -> missing headers (skipped, left pending)
      dataNotes: [],
      stats: { changedTabs: [], recs: 0, research: 0, pushedTests: 0, resultsBack: 0, docsChanged: [],
               proposals: 0, rulesAdded: 0, knowledgeMirrored: false }
    };

    checkHeaders_(ctx);

    // Phase 1: detect (nothing is marked as processed yet).
    ctx.stats.changedTabs = snapshotAuditTabs_(ctx);
    ctx.docs = snapshotReferenceDocs_(ctx);

    // Phase 2: process. Every write below is idempotent.
    if (ctx.stats.changedTabs.length) runAuditRules_(ctx);
    syncTestResultsBack_(ctx);
    mirrorAuditKnowledge_(ctx);
    proposeNewKnowledge_(ctx);
    promoteApprovedKnowledge_(ctx);
    indexReferenceTabs_(ctx);
    pushApprovedToAudit_(ctx);
    updateBriefing_(ctx);

    // Phase 3: commit.
    commitSync_(ctx);
    ensureTrigger_();

    var hasWarnings = ctx.warnings.length > 0;
    setControl_(brain, 'System status', hasWarnings ? 'ACTIVE — WARNINGS' : 'ACTIVE',
      hasWarnings ? 'See CHANGE LOG: ' + ctx.warnings.length + ' warning(s)' : 'Sync running');
    setControl_(brain, 'Last refresh UTC', ctx.now, hasWarnings ? 'OK with warnings' : 'OK');
    clearLastError_(brain, ctx.now);

    var s = ctx.stats;
    logChange_(brain, 'refresh', 'Audit ⇄ Brain',
      'Changed tabs: ' + (s.changedTabs.join(', ') || 'none') +
      ' | docs changed: ' + (s.docsChanged.join(', ') || 'none') +
      ' | new recs: ' + s.recs + ' | research items: ' + s.research +
      ' | tests pushed: ' + s.pushedTests + ' | results synced back: ' + s.resultsBack +
      ' | knowledge proposals: ' + s.proposals + ' | rules added: ' + s.rulesAdded +
      ' | AUDIT KNOWLEDGE ' + (s.knowledgeMirrored ? 'refreshed' : 'unchanged'),
      hasWarnings ? 'OK WITH WARNINGS' : 'OK', ctx.warnings.join(' || ').slice(0, 2000));
  } catch (err) {
    var msg = String(err && err.stack ? err.stack : err);
    var pending = ctx && ctx.stats && ctx.stats.changedTabs.length
      ? ' Pending (will be redone next run): ' + ctx.stats.changedTabs.join(', ') + '.' : '';
    try {
      setControl_(brain, 'Last error', nowUtc_() + ' — ' + String(err) + pending, 'Error — see CHANGE LOG');
      setControl_(brain, 'System status', 'ERROR', 'Last sync failed; nothing was marked as processed');
      logChange_(brain, 'refresh', 'Audit ⇄ Brain', 'Sync failed. Nothing committed.' + pending, 'FAILED', msg.slice(0, 2000));
    } catch (ignored) {}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** Installs exactly one daily trigger for refreshBirdieBrain (~8 a.m. Eastern). */
function installBirdieTrigger() {
  deleteSyncTriggers_();
  ScriptApp.newTrigger('refreshBirdieBrain')
    .timeBased().everyDays(1).atHour(CONFIG.DAILY_HOUR).inTimezone(CONFIG.TIMEZONE).create();
  PropertiesService.getScriptProperties().setProperty('trigger:spec', triggerSpec_());
  var brain = getBrain_();
  setControl_(brain, 'Refresh frequency', 'Daily ~' + CONFIG.DAILY_HOUR + ':00 a.m. Eastern (' + CONFIG.TIMEZONE + ')', 'Active');
  logChange_(brain, 'trigger', 'refreshBirdieBrain', 'Daily trigger installed: ' + triggerSpec_(), 'OK', '');
}

/** Menu: turn off automatic sync. Removes only this script's sync trigger. */
function turnOffBirdieSync() {
  var removed = deleteSyncTriggers_();
  PropertiesService.getScriptProperties().deleteProperty('trigger:spec');
  var brain = getBrain_();
  setControl_(brain, 'Refresh frequency', 'Off (manual: Birdie Sync › Run sync now)', 'Not active');
  setControl_(brain, 'System status', 'PAUSED', 'Automatic sync turned off');
  logChange_(brain, 'trigger', 'refreshBirdieBrain', 'Automatic sync turned off; removed ' + removed + ' trigger(s)', 'OK', '');
}

/** Kept for compatibility with the first version's menu. */
function removeBirdieTriggers() { turnOffBirdieSync(); }

function deleteSyncTriggers_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshBirdieBrain') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

function triggerSpec_() { return 'daily@' + CONFIG.DAILY_HOUR + ':00 ' + CONFIG.TIMEZONE; }

/** Reinstalls the trigger when there isn't exactly one or its schedule is out of date. */
function ensureTrigger_() {
  var count = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'refreshBirdieBrain';
  }).length;
  var spec = PropertiesService.getScriptProperties().getProperty('trigger:spec');
  if (count !== 1 || spec !== triggerSpec_()) installBirdieTrigger();
}

// ───────────────────────────── Header check ──────────────────────────────

function checkHeaders_(ctx) {
  // Birdie Brain: the script writes here, so a missing column stops the run.
  var brainProblems = [];
  Object.keys(REQUIRED_HEADERS.brain).forEach(function (tab) {
    var sh = ctx.brain.getSheetByName(tab);
    if (!sh) { brainProblems.push(tab + ' (tab missing)'); return; }
    var missing = missingHeaders_(readTable_(sh).headers, REQUIRED_HEADERS.brain[tab]);
    if (missing.length) brainProblems.push(tab + ': ' + missing.join(', '));
  });
  if (brainProblems.length) {
    throw new Error('Birdie Brain is missing required columns, so nothing was written. ' + brainProblems.join(' | '));
  }
  // Audit: a tab with a missing column is skipped and left pending.
  Object.keys(REQUIRED_HEADERS.audit).forEach(function (tab) {
    var sh = ctx.audit.getSheetByName(tab);
    var missing = sh ? missingHeaders_(readTable_(sh).headers, REQUIRED_HEADERS.audit[tab]) : ['(tab missing)'];
    if (missing.length) {
      ctx.blockedTabs[tab] = missing;
      warn_(ctx, 'Audit › ' + tab + ' skipped: missing column(s) ' + missing.join(', ') + '. Not marked as synced.');
    }
  });
}

function missingHeaders_(have, need) {
  return need.filter(function (h) { return have.indexOf(h) === -1; });
}

function usable_(ctx, tab) { return !ctx.blockedTabs[tab] && !!ctx.audit.getSheetByName(tab); }

function warn_(ctx, msg) { ctx.warnings.push(msg); }

// ───────────────────────────── Detect & commit ───────────────────────────

/** Phase 1: fingerprint watched Audit tabs. Returns changed tab names. Writes nothing. */
function snapshotAuditTabs_(ctx) {
  var changed = [];
  CONFIG.AUDIT_TABS_WATCHED.forEach(function (name) {
    var sh = ctx.audit.getSheetByName(name);
    if (!sh || ctx.blockedTabs[name]) return;
    var values = sh.getDataRange().getDisplayValues();
    var digest = sha256_(JSON.stringify(values));
    var key = 'digest:audit:' + name;
    var prev = ctx.props.getProperty(key);
    if (prev === digest) return;

    var table = tableFromValues_(values);
    var last = table.rows.length ? table.rows[table.rows.length - 1] : null;
    var sample = last ? table.headers.slice(0, 4).map(function (h) { return last[h]; })
      .filter(String).join(' | ') : '(no data rows)';
    ctx.pendingProps[key] = digest;
    ctx.pendingSnapRows.push([ctx.now, 'Audit › ' + name, table.rows.length, digest, sample.slice(0, 300),
      prev ? 'Changed since last sync' : 'Baseline (first sync)']);
    changed.push(name);
  });
  return changed;
}

/** Phase 3: record SYNC SNAPSHOTS rows and fingerprints only after everything succeeded. */
function commitSync_(ctx) {
  var snap = mustSheet_(ctx.brain, BRAIN.SNAPSHOTS);
  ctx.pendingSnapRows.forEach(function (r) { snap.appendRow(r); });
  ctx.pendingProps['sync:lastCommit'] = ctx.now;
  ctx.props.setProperties(ctx.pendingProps);
}

/** Read-only fingerprint of both reference Docs. Never writes to them. */
function snapshotReferenceDocs_(ctx) {
  var docs = [
    { id: ctx.ids.octDoc, label: 'October Creator Marketing Master Playbook' },
    { id: ctx.ids.novDoc, label: 'November TikTok Master Reset' }
  ];
  var research = mustSheet_(ctx.brain, BRAIN.RESEARCH);
  var notesText = readTable_(research).rows.map(function (r) { return r['Notes'] || ''; }).join('\n');
  var out = [];
  docs.forEach(function (d) {
    if (!d.id) return;
    var info = { label: d.label, url: 'https://docs.google.com/document/d/' + d.id + '/edit', updated: '', words: 0, ok: false };
    try {
      var file = DriveApp.getFileById(d.id);
      info.updated = Utilities.formatDate(file.getLastUpdated(), 'UTC', 'yyyy-MM-dd HH:mm') + ' UTC';
      var text = readDocText_(d.id);
      info.words = text.split(/\s+/).filter(String).length;
      info.ok = true;
      var digest = sha256_(text);
      var key = 'digest:doc:' + d.id;
      var prev = ctx.props.getProperty(key);
      if (prev !== digest) {
        ctx.pendingSnapRows.push([ctx.now, 'Doc › ' + d.label, info.words + ' words', digest,
          'Last edited ' + info.updated, prev ? 'Reference changed — review only' : 'Baseline (first sync)']);
        if (prev) {
          var tag = 'sync-key:' + sha256_('doc|' + d.id + '|' + digest).slice(0, 10);
          if (notesText.indexOf(tag) === -1) {
            appendByHeaders_(research, {
              'Submitted UTC': ctx.now,
              'Claim / source': 'Reference doc updated: ' + d.label + '. Check whether BRAND RULES / VIDEO EDITING RULES that cite it need revising. Nothing was changed automatically.',
              'Link': info.url, 'Reviewed date': '', 'Evidence class': 'BRAND BRIEF',
              'Implications': 'Rules sourced from this doc may now be out of date', 'Status': 'Pending review',
              'Notes': 'Doc last edited ' + info.updated + ' ' + tag
            });
            notesText += '\n' + tag;
            ctx.stats.research++;
          }
          ctx.stats.docsChanged.push(d.label);
        }
        ctx.pendingProps[key] = digest;
      }
    } catch (e) {
      info.error = String(e);
      warn_(ctx, 'Could not read reference doc ' + d.label + ': ' + String(e));
    }
    out.push(info);
  });
  return out;
}

/** Plain text of every tab in a Google Doc (falls back to the main body). */
function readDocText_(id) {
  var doc = DocumentApp.openById(id);
  try {
    if (doc.getTabs) {
      var parts = [];
      var walk = function (tabs) {
        tabs.forEach(function (t) {
          parts.push(t.asDocumentTab().getBody().getText());
          if (t.getChildTabs) walk(t.getChildTabs());
        });
      };
      walk(doc.getTabs());
      if (parts.length) return parts.join('\n');
    }
  } catch (e) { /* older runtime: fall through */ }
  return doc.getBody().getText();
}

// ───────────────────────────── Audit ➜ Brain ─────────────────────────────

/** Rule-based observations. Every result waits for review; nothing becomes a rule automatically. */
function runAuditRules_(ctx) {
  var T = CONFIG.THRESHOLDS;
  var recSheet = mustSheet_(ctx.brain, BRAIN.RECS);
  var existing = {};
  readTable_(recSheet).rows.forEach(function (r) { if (r['Proposal ID']) existing[r['Proposal ID']] = true; });

  function addRec(ruleKey, problem, experiment, evidence, sources, metric) {
    var id = 'AUTO-' + sha256_(ruleKey).slice(0, 8);
    if (existing[id]) return;
    existing[id] = true;
    appendByHeaders_(recSheet, {
      'Created UTC': ctx.now, 'Proposal ID': id, 'Problem or observation': problem,
      'Recommended experiment': experiment, 'Evidence level': evidence, 'Source references': sources,
      'Success metric': metric, 'Review status': 'Pending review', 'Decision / notes': ''
    });
    ctx.stats.recs++;
  }

  var changed = {};
  ctx.stats.changedTabs.forEach(function (n) { changed[n] = true; });

  // Follow conversion: latest dated SNAPSHOT per post (official source). POST LOG
  // fills in only for logged posts (with a Posted date). Historical grid rows
  // (no posted date) are never judged: their follows can't be recorded.
  if ((changed['SNAPSHOTS'] || changed['POST LOG']) && usable_(ctx, 'SNAPSHOTS') && usable_(ctx, 'POST LOG')) {
    var latest = latestReadings_(ctx);
    Object.keys(latest).forEach(function (pid) {
      var r = latest[pid];
      if (r.views === null || r.views < T.minViewsForRate) return;
      if (r.follows === null) {
        addRec('missing-follows|' + pid,
          pid + ' has ' + fmtInt_(r.views) + ' views (' + r.where + (r.when ? ', ' + r.when : '') + ') but no Follows recorded (PENDING).',
          'Record follows, plus profile visits if TikTok Studio shows them, for ' + pid + ' at a dated reading so follow conversion can be judged (BR-09).',
          'PENDING', 'Audit › ' + r.where + '; BR-09', 'Follows / 1K views recorded');
        return;
      }
      var rate = r.follows / r.views * 1000;
      if (rate < T.followsPer1kLow) {
        addRec('low-follow-rate|' + pid,
          pid + ' converted ' + rate.toFixed(2) + ' follows per 1K views at ' + fmtInt_(r.views) +
          ' views (' + r.where + (r.when ? ', ' + r.when : '') + '). Below the ' + T.followsPer1kLow.toFixed(1) + ' follows/1K threshold (OBSERVED).',
          'On the next post with the same job, test one change aimed at following (e.g. a profile-directed CTA or the BR-13 bio test). Compare follows/1K at a similar number of hours after posting.',
          'HYPOTHESIS', 'Audit › ' + r.where + '; START HERE follow-rate definition; BR-09; BR-13',
          'Follows / 1K views above ' + T.followsPer1kLow.toFixed(1) + ' at a comparable reading');
      }
    });
  }

  // Hook retention.
  if (changed['RETENTION'] && usable_(ctx, 'RETENTION')) {
    readTable_(ctx.audit.getSheetByName('RETENTION')).rows.forEach(function (r) {
      var pid = r['ID']; var ret = parsePct_(r['3-sec retention']);
      if (!pid || ret === null || ret >= T.threeSecRetentionLow) return;
      addRec('low-3s-retention|' + pid,
        pid + ' kept ' + pct_(ret) + ' of viewers at 3 seconds (snapshot ' + (r['Snapshot'] || NOT_RECORDED) +
        '; largest drop ' + (r['Largest drop'] || NOT_RECORDED) + ') (OBSERVED).',
        'Recut the first 2–3 seconds with a specific recognition hook and a visual that works without sound (ED-02). Keep the rest the same.',
        'HYPOTHESIS', 'Audit › RETENTION; ED-02; BR-06', '3-sec retention ≥ ' + pct_(T.threeSecRetentionLow));
    });
  }

  // Audience fit.
  if (changed['AUDIENCE'] && usable_(ctx, 'AUDIENCE')) {
    readTable_(ctx.audit.getSheetByName('AUDIENCE')).rows.forEach(function (r) {
      var pid = r['ID']; if (!pid) return;
      var a = audienceOf_(r);
      var misses = [];
      if (a.female !== null && a.female < T.audienceFemaleMin) misses.push('female ' + pct_(a.female) + ' (target ≥ ' + pct_(T.audienceFemaleMin) + ')');
      if (a.age45 !== null && a.age45 < T.audience45PlusMin) misses.push('age 45+ ' + pct_(a.age45) + ' (target ≥ ' + pct_(T.audience45PlusMin) + ')');
      if (a.us !== null && a.us < T.audienceUsMin) misses.push('US ' + pct_(a.us) + ' (target ≥ ' + pct_(T.audienceUsMin) + ')');
      if (!misses.length) return;
      addRec('audience-drift|' + pid + '|' + (r['Snapshot'] || ''),
        pid + ' audience at ' + (r['Snapshot'] || NOT_RECORDED) + ' is off target: ' + misses.join('; ') + ' (OBSERVED).',
        'Check whether the hook, sound or topic pulled a different crowd. Next comparable post: open on a scene specific to Gen X midlife women (BR-04) and compare audience mix at a similar reading.',
        'HYPOTHESIS', 'Audit › AUDIENCE; MIRROR & FUNNELS › AUDIENCE; BR-01; BR-04',
        'Female ≥ ' + pct_(T.audienceFemaleMin) + ', 45+ ≥ ' + pct_(T.audience45PlusMin) + ', US ≥ ' + pct_(T.audienceUsMin));
    });
  }

  // Finished experiments → research queue for a human decision about promoting them to a rule.
  var research = mustSheet_(ctx.brain, BRAIN.RESEARCH);
  var researchNotes = readTable_(research).rows.map(function (r) { return r['Notes'] || ''; }).join('\n');
  function addResearch(syncKey, claim, link, implications) {
    var tag = 'sync-key:' + sha256_(syncKey).slice(0, 10);
    if (researchNotes.indexOf(tag) !== -1) return;
    researchNotes += '\n' + tag;
    appendByHeaders_(research, {
      'Submitted UTC': ctx.now, 'Claim / source': claim, 'Link': link, 'Reviewed date': '',
      'Evidence class': 'OBSERVED', 'Implications': implications, 'Status': 'Pending review', 'Notes': tag
    });
    ctx.stats.research++;
  }
  var auditUrl = 'https://docs.google.com/spreadsheets/d/' + ctx.ids.audit + '/edit';

  if (changed['CREATIVE TESTS'] && usable_(ctx, 'CREATIVE TESTS')) {
    readTable_(ctx.audit.getSheetByName('CREATIVE TESTS')).rows.forEach(function (r) {
      var id = r['Test']; var result = (r['Result'] || '').trim();
      if (!id || !result || /^pending$/i.test(result)) return;
      addResearch('creative-test|' + id + '|' + result,
        'Creative test ' + id + ' result: ' + result + (r['Decision'] ? ' — decision: ' + r['Decision'] : '') +
        '. Hypothesis: ' + (r['Hypothesis'] || NOT_RECORDED),
        auditUrl, 'Decide whether this stays a single result or becomes a rule (BR-11: don\'t promote a hypothesis on its own).');
    });
  }
  if (changed['SHOP CREATIVE TESTS'] && usable_(ctx, 'SHOP CREATIVE TESTS')) {
    readTable_(ctx.audit.getSheetByName('SHOP CREATIVE TESTS')).rows.forEach(function (r) {
      var id = r['ID']; var status = (r['Status'] || '').trim();
      if (!id || !/(complete|done|result|won|lost|winner|confirmed)/i.test(status)) return;
      addResearch('shop-test|' + id + '|' + status,
        'Shop test ' + id + ' (' + (r['Category'] || '') + ') is now "' + status + '": ' + (r['Evidence / claim'] || ''),
        auditUrl, 'Review it against BR-10 (authentic commerce) before changing any commerce rule.');
    });
  }
}

/**
 * Latest reading per post, chosen by actual date/time, not row position.
 *   1. SNAPSHOTS (source of truth). Timestamp = Date + Time; if missing, Posted
 *      date/time + "Hours after post". Rows with a timestamp beat rows without.
 *      Exact duplicate timestamps: the lower row wins (treated as a correction).
 *   2. POST LOG fills in only for logged posts (Posted date present).
 * Data issues (missing timestamps, duplicates) are noted in ctx.dataNotes.
 */
function latestReadings_(ctx) {
  if (ctx._latest) return ctx._latest;
  var audit = ctx.audit;
  var out = {};
  var posted = {};
  var log = audit.getSheetByName('POST LOG');
  var logRows = log ? readTable_(log).rows : [];
  logRows.forEach(function (r) {
    if (r['ID'] && r['Posted date']) posted[r['ID']] = parseDateTime_(r['Posted date'], r['Time']);
  });

  var snaps = audit.getSheetByName('SNAPSHOTS');
  var noTs = 0, dupes = 0, seen = {};
  if (snaps) {
    readTable_(snaps).rows.forEach(function (r) {
      var pid = r['ID']; if (!pid) return;
      var hours = parseNum_(r['Hours after post']);
      var ts = parseDateTime_(r['Date'], r['Time']);
      if (ts === null && hours !== null && posted[pid] != null) ts = posted[pid] + hours * 3600 * 1000;
      if (ts === null) noTs++;
      var dupKey = pid + '|' + ts;
      if (ts !== null && seen[dupKey]) dupes++;
      seen[dupKey] = true;
      var cand = { views: parseNum_(r['Views']), follows: parseNum_(r['Follows']), hours: hours, ts: ts,
        where: 'SNAPSHOTS', when: [r['Date'], r['Time']].filter(String).join(' ') || (hours !== null ? hours + ' h after post' : '') };
      var prev = out[pid];
      if (!prev || newerReading_(cand, prev)) out[pid] = cand;
    });
  }
  if (noTs) ctx.dataNotes.push(noTs + ' SNAPSHOTS row(s) without a usable date/time');
  if (dupes) ctx.dataNotes.push(dupes + ' duplicate SNAPSHOTS timestamp(s); the lower row was used');

  logRows.forEach(function (r) {
    var pid = r['ID']; if (!pid || !r['Posted date'] || out[pid]) return;
    out[pid] = { views: parseNum_(r['Views']), follows: parseNum_(r['Follows']), hours: null, ts: null,
      where: 'POST LOG', when: r['Posted date'] };
  });
  ctx._latest = out;
  return out;
}

/** true if reading a is newer than b. Equal = later row wins (a comes later). */
function newerReading_(a, b) {
  if (a.ts !== null && b.ts !== null) return a.ts >= b.ts;
  if (a.ts !== null) return true;
  if (b.ts !== null) return false;
  if (a.hours !== null && b.hours !== null) return a.hours >= b.hours;
  if (a.hours !== null) return true;
  if (b.hours !== null) return false;
  return true;
}

/** Copy results Becky entered in Audit › CREATIVE TESTS for AUTO- experiments back into AI RECOMMENDATIONS. */
function syncTestResultsBack_(ctx) {
  if (!usable_(ctx, 'CREATIVE TESTS')) return;
  var results = {};
  readTable_(ctx.audit.getSheetByName('CREATIVE TESTS')).rows.forEach(function (r) {
    var id = r['Test'] || '';
    var res = (r['Result'] || '').trim();
    if (id.indexOf('AUTO-') === 0 && res && !/^pending$/i.test(res)) {
      results[id] = 'Audit result: ' + res + (r['Decision'] ? ' | Decision: ' + r['Decision'] : '') +
        (r['Next action'] && r['Next action'] !== PUSHED_NEXT_ACTION ? ' | Next: ' + r['Next action'] : '');
    }
  });
  if (!Object.keys(results).length) return;

  var recSheet = mustSheet_(ctx.brain, BRAIN.RECS);
  var t = readTable_(recSheet);
  var notesCol = t.headers.indexOf('Decision / notes');
  t.rows.forEach(function (r) {
    var line = results[r['Proposal ID']];
    if (!line) return;
    var current = r['Decision / notes'] || '';
    if (current.indexOf(line) !== -1) return;
    var cleaned = current.replace(/\s*\[synced [^\]]*\][^\n]*/g, '').trim();
    var next = (cleaned ? cleaned + '\n' : '') + '[synced ' + ctx.today + '] ' + line;
    recSheet.getRange(r._row, notesCol + 1).setValue(next);
    ctx.stats.resultsBack++;
  });
}

/** Female / 45+ / US shares from an AUDIENCE row (45+ is summed from age bands when the total is blank). */
function audienceOf_(r) {
  var age45 = parsePct_(r['45+ total']);
  if (age45 === null) {
    var a = parsePct_(r['45–54']), b = parsePct_(r['55+']);
    if (a !== null && b !== null) age45 = a + b;
  }
  return { female: parsePct_(r['Female']), age45: age45, us: parsePct_(r['USA']), nonFollowers: parsePct_(r['Non-followers']) };
}

/** Read-only copy of the Audit knowledge tabs in Birdie Brain › AUDIT KNOWLEDGE. */
function mirrorAuditKnowledge_(ctx) {
  var target = ctx.brain.getSheetByName(CONFIG.KNOWLEDGE_MIRROR_TAB);
  var changed = ctx.stats.changedTabs.some(function (n) { return CONFIG.KNOWLEDGE_TABS.indexOf(n) !== -1; });
  if (target && !changed) return;
  if (target && !ownedSheet_(target, KNOWLEDGE_MARKER)) {
    warn_(ctx, 'Brain › ' + CONFIG.KNOWLEDGE_MIRROR_TAB + ' exists but was not created by this script (A1 has no script marker). Left untouched; rename that tab to let the script create its own.');
    return;
  }

  var rows = [[KNOWLEDGE_MARKER + '. Don\'t edit here: this tab is rebuilt whenever a source tab changes. Edit the Audit workbook instead.',
    'Last copied: ' + ctx.now]];
  var bands = [];
  CONFIG.KNOWLEDGE_TABS.forEach(function (name) {
    var sh = ctx.audit.getSheetByName(name);
    rows.push(['']);
    if (!sh) { rows.push([name + ' — tab not found in Audit workbook']); warn_(ctx, 'Knowledge tab not found: ' + name); return; }
    var t = readTable_(sh);
    var cols = t.headers.filter(String);
    bands.push(rows.length + 1);
    rows.push([name + ' (' + t.rows.length + ' rows) — https://docs.google.com/spreadsheets/d/' + ctx.ids.audit + '/edit#gid=' + sh.getSheetId()]);
    rows.push(cols);
    t.rows.forEach(function (r) { rows.push(cols.map(function (c) { return r[c] || ''; })); });
  });
  var width = padRows_(rows);

  target = target || ctx.brain.insertSheet(CONFIG.KNOWLEDGE_MIRROR_TAB);
  target.clear();
  ensureSize_(target, rows.length, width);
  target.getRange(1, 1, rows.length, width).setValues(rows);
  target.setFrozenRows(1);
  target.getRange(1, 1, 1, width).setFontWeight('bold');
  bands.forEach(function (r) {
    target.getRange(r, 1, 1, width).setFontWeight('bold').setBackground('#FFF4D6');
    target.getRange(r + 1, 1, 1, width).setFontWeight('bold');
  });
  ctx.stats.knowledgeMirrored = true;
}

/** Stable identity for a knowledge row: its ID column, else a hash of its contents. */
function knowledgeRowId_(tab, t, r) {
  var id = r[t.headers[0]];
  return id ? id : 'ROW-' + sha256_(tab + JSON.stringify(r)).slice(0, 8);
}

/** Readable proposal text for a new knowledge row. */
function describeKnowledge_(tab, r) {
  var pick = function (label, key) { return r[key] ? label + r[key] : ''; };
  var join = function (parts) { return parts.filter(String).join(' · '); };
  if (tab === 'INSPIRATION BANK') return {
    change: join(['Inspiration idea' + (r['Theme / territory'] ? ' (' + r['Theme / territory'] + ')' : ''),
      pick('Becky direction: ', 'Original Becky direction (idea only)'), pick('Hook: ', 'Hook / psychology'),
      pick('Mirror: ', 'Audience mirror'), pick('Pillar: ', 'Content pillar')]),
    why: join([pick('Why it caught attention: ', 'Why it caught attention'), pick('Attribution: ', 'Source attribution'), pick('Audit status: ', 'Status')])
  };
  if (tab === 'CREATOR TRAINING LAB') return {
    change: join([(r['Category'] ? r['Category'] + ': ' : '') + (r['Rule / learning'] || ''),
      pick('Apply: ', 'Becky application'), pick('Standard: ', 'Execution standard'), pick('Measure: ', 'Test / measurement')]),
    why: join([pick('Observed: ', 'Observed evidence'), pick('Source: ', 'Source / reference'), pick('Audit status: ', 'Status')])
  };
  if (tab === 'VISUAL STYLE GUIDE') return {
    change: join([(r['Style element'] || 'Visual style') + ': ' + [r['Color name'], r['Approx. HEX']].filter(String).join(' '),
      pick('Treatment: ', 'Visual treatment'), pick('Best use: ', 'Best use'), pick('Readability: ', 'Contrast / readability'), pick('Guidance: ', 'Brand guidance')]),
    why: join([pick('Source: ', 'Source image'), pick('Audit status: ', 'Status')])
  };
  return { change: Object.keys(r).filter(function (k) { return k !== '_row' && r[k]; }).map(function (k) { return k + ': ' + r[k]; }).join(' · '), why: '' };
}

/** New rows in INSPIRATION BANK / CREATOR TRAINING LAB / VISUAL STYLE GUIDE → APPROVAL QUEUE (Pending review). */
function proposeNewKnowledge_(ctx) {
  var queue = mustSheet_(ctx.brain, BRAIN.APPROVALS);
  var queued = {};
  readTable_(queue).rows.forEach(function (r) { if (r['Proposal ID']) queued[r['Proposal ID']] = true; });
  var all = ctx.props.getProperties();

  CONFIG.PROPOSE_FROM_TABS.forEach(function (tab) {
    if (!usable_(ctx, tab)) return;
    var baselineKey = 'baseline:knowledge:' + tab;
    var firstSync = !all[baselineKey];
    if (!firstSync && ctx.stats.changedTabs.indexOf(tab) === -1) return;

    var t = readTable_(ctx.audit.getSheetByName(tab));
    t.rows.forEach(function (r) {
      var rowId = knowledgeRowId_(tab, t, r);
      var pid = 'KNOW-' + sha256_(tab + '|' + rowId).slice(0, 8);
      var seenKey = 'seen:' + pid;
      if (all[seenKey] || queued[pid]) return;
      ctx.pendingProps[seenKey] = '1';
      if (firstSync && !CONFIG.QUEUE_EXISTING_KNOWLEDGE_ON_FIRST_SYNC) return;
      var d = describeKnowledge_(tab, r);
      appendByHeaders_(queue, {
        'Created UTC': ctx.now, 'Proposal ID': pid, 'Proposed change': d.change,
        'Source / reasoning': 'Audit › ' + tab + ' › ' + rowId + (d.why ? ' — ' + d.why : ''),
        'Status': 'Pending review', 'Reviewed by': '', 'Reviewed at': '',
        'Notes': 'Set Status to "Approved" to add to VIDEO EDITING RULES as ' + rowId + '. "Rejected" leaves it in the Audit workbook only.'
      });
      queued[pid] = true;
      ctx.stats.proposals++;
    });
    if (firstSync) ctx.pendingProps[baselineKey] = ctx.now;
  });
}

/** KNOW- proposals whose Status is exactly "Approved" become VIDEO EDITING RULES rows (once each). */
function promoteApprovedKnowledge_(ctx) {
  var queue = readTable_(mustSheet_(ctx.brain, BRAIN.APPROVALS));
  var approved = queue.rows.filter(function (r) {
    return /^KNOW-/.test(r['Proposal ID'] || '') && isApproved_(r['Status']);
  });
  if (!approved.length) return;
  var rulesSheet = mustSheet_(ctx.brain, BRAIN.EDITING);
  var rules = readTable_(rulesSheet);
  var have = {};
  rules.rows.forEach(function (r) { have[r['Rule ID']] = true; });
  var labels = { 'INSPIRATION BANK': 'Inspiration idea', 'CREATOR TRAINING LAB': 'Creator training', 'VISUAL STYLE GUIDE': 'Visual style' };
  approved.forEach(function (r) {
    var m = String(r['Source / reasoning'] || '').match(/^Audit › (.+?) › (\S+)/);
    var tab = m ? m[1] : '';
    var ruleId = m ? m[2] : r['Proposal ID'];
    if (have[ruleId]) return;
    appendByHeaders_(rulesSheet, {
      'Rule ID': ruleId,
      'Task': labels[tab] || tab || 'Approved knowledge',
      'Workflow': r['Proposed change'],
      'Evidence required': (r['Source / reasoning'] || '') + ' | approved ' + (r['Reviewed at'] || ctx.today) + (r['Reviewed by'] ? ' by ' + r['Reviewed by'] : ''),
      'Avoid': ''
    });
    have[ruleId] = true;
    ctx.stats.rulesAdded++;
    logChange_(ctx.brain, 'promote-rule', BRAIN.EDITING, ruleId + ' added from ' + r['Proposal ID'], 'OK', '');
  });
}

/** List reference-only Audit tabs in SOURCE INDEX (added once each, never synced). */
function indexReferenceTabs_(ctx) {
  var sh = mustSheet_(ctx.brain, BRAIN.SOURCES);
  var t = readTable_(sh);
  var names = {}, maxN = 0;
  t.rows.forEach(function (r) {
    names[r['Name']] = true;
    var m = String(r['Source ID'] || '').match(/^S-(\d+)$/);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  });
  Object.keys(CONFIG.REFERENCE_ONLY_TABS).forEach(function (tab) {
    var name = 'Audit › ' + tab;
    if (names[name]) return;
    var tabSheet = ctx.audit.getSheetByName(tab);
    if (!tabSheet) return;
    var info = CONFIG.REFERENCE_ONLY_TABS[tab];
    maxN++;
    appendByHeaders_(sh, {
      'Source ID': 'S-' + (maxN < 10 ? '0' : '') + maxN,
      'Type': 'Sheet tab (reference only)',
      'Name': name,
      'URL': 'https://docs.google.com/spreadsheets/d/' + ctx.ids.audit + '/edit#gid=' + tabSheet.getSheetId(),
      'Data authority': info[0],
      'Read when': info[1]
    });
    names[name] = true;
  });
}

// ───────────────────────────── Brain ➜ Audit ─────────────────────────────

function pushApprovedToAudit_(ctx) {
  var brand = readTable_(mustSheet_(ctx.brain, BRAIN.BRAND));
  var editing = readTable_(mustSheet_(ctx.brain, BRAIN.EDITING));
  var approvals = readTable_(mustSheet_(ctx.brain, BRAIN.APPROVALS));
  var recs = readTable_(mustSheet_(ctx.brain, BRAIN.RECS));

  var approvedChanges = approvals.rows.filter(function (r) { return isApproved_(r['Status']); });
  var approvedRecs = recs.rows.filter(function (r) { return isApproved_(r['Review status']); });

  // 1) Script-owned mirror tab (only rebuilt if the script created it).
  var mirror = ctx.audit.getSheetByName(CONFIG.MIRROR_TAB);
  if (mirror && !ownedSheet_(mirror, MIRROR_MARKER)) {
    warn_(ctx, 'Audit › ' + CONFIG.MIRROR_TAB + ' exists but was not created by this script (A1 has no script marker). Left untouched; rename that tab to let the script create its own.');
  } else {
    var rows = [[MIRROR_MARKER + '. Don\'t edit here: this tab is rebuilt on every sync. Make changes in Birdie Brain.', 'Last pushed: ' + ctx.now], ['']];
    var section = function (title, table, list) {
      var cols = table.headers.filter(String);
      rows.push([title + ' (' + list.length + ')']);
      rows.push(cols);
      if (!list.length) rows.push(['— none yet —']);
      list.forEach(function (r) { rows.push(cols.map(function (c) { return r[c] || ''; })); });
      rows.push(['']);
    };
    section('APPROVED BRAND RULES', brand, brand.rows.filter(function (r) { return r['Rule ID']; }));
    section('APPROVED VIDEO EDITING RULES', editing, editing.rows.filter(function (r) { return r['Rule ID']; }));
    section('APPROVED CHANGES (from APPROVAL QUEUE)', approvals, approvedChanges);
    section('APPROVED EXPERIMENTS (from AI RECOMMENDATIONS)', recs, approvedRecs);
    var width = padRows_(rows);

    mirror = mirror || ctx.audit.insertSheet(CONFIG.MIRROR_TAB);
    mirror.clear();
    ensureSize_(mirror, rows.length, width);
    mirror.getRange(1, 1, rows.length, width).setValues(rows);
    mirror.setFrozenRows(1);
    rows.forEach(function (r, i) {
      if (/^APPROVED /.test(r[0])) mirror.getRange(i + 1, 1, 1, width).setFontWeight('bold').setBackground('#FFF4D6');
    });
    mirror.getRange(1, 1, 1, width).setFontWeight('bold');
  }

  // 2) Approved experiments are appended (never overwritten) to the Audit test log, once each.
  if (!CONFIG.APPEND_APPROVED_TO_CREATIVE_TESTS || !approvedRecs.length || !usable_(ctx, 'CREATIVE TESTS')) return;
  var tests = ctx.audit.getSheetByName('CREATIVE TESTS');
  var present = {};
  readTable_(tests).rows.forEach(function (r) { if (r['Test']) present[r['Test']] = true; });
  approvedRecs.forEach(function (r) {
    var id = r['Proposal ID'];
    if (!id || present[id]) return;
    appendByHeaders_(tests, {
      'Test': id,
      'Date': ctx.today,
      'Hypothesis': r['Recommended experiment'],
      'Primary measure': r['Success metric'],
      'Benchmark': r['Problem or observation'],
      'Result': 'Pending',
      'Decision': 'Planned (approved in Birdie Brain)',
      'Next action': PUSHED_NEXT_ACTION
    });
    present[id] = true;
    ctx.stats.pushedTests++;
  });
}

// ───────────────────────────── Briefing ──────────────────────────────────

/**
 * Writes only rows whose column A starts with "Auto · " (columns A:B).
 * Never touches B1 or any manually typed row. New Auto rows go below the
 * last used row of the sheet, so they can't land on someone's notes.
 */
function updateBriefing_(ctx) {
  var sh = mustSheet_(ctx.brain, BRAIN.BRIEFING);
  var lines = {};

  var eastern = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd h:mm a 'ET'");
  lines['Last sync'] = eastern + ' (' + ctx.now + ')' + (ctx.stats.changedTabs.length
    ? ' — changed: ' + ctx.stats.changedTabs.join(', ') : ' — no Audit changes since last sync');

  if (usable_(ctx, 'POST LOG')) {
    var posts = readTable_(ctx.audit.getSheetByName('POST LOG')).rows.filter(function (r) { return r['ID'] && r['Posted date']; });
    var p = latestBy_(posts, function (r) { return parseDateTime_(r['Posted date'], r['Time']); });
    if (p) lines['Latest logged post'] = p['ID'] + ' · ' + p['Posted date'] + ' · ' + (p['Topic'] || '') +
      ' · ' + fmtInt_(parseNum_(p['Views'])) + ' views (POST LOG reading) · job: ' + (p['Job'] || NOT_RECORDED);
  }

  if (usable_(ctx, 'SNAPSHOTS') && usable_(ctx, 'POST LOG')) {
    var readings = latestReadings_(ctx);
    var rated = Object.keys(readings).map(function (pid) {
      var r = readings[pid];
      return (r.views && r.follows !== null) ? { pid: pid, rate: r.follows / r.views * 1000, r: r } : null;
    }).filter(Boolean);
    if (rated.length) {
      rated.sort(function (a, b) { return b.r.views - a.r.views; });
      lines['Follow rate (latest reading, largest posts)'] = rated.slice(0, 3).map(function (x) {
        return x.pid + ' ' + x.rate.toFixed(2) + '/1K at ' + fmtInt_(x.r.views) + ' views (' + x.r.where + (x.r.when ? ' ' + x.r.when : '') + ')';
      }).join('; ');
    }
  }

  if (usable_(ctx, 'SHOP KPI BASELINE')) {
    lines['Latest TikTok Shop period'] = describeShopPeriod_(ctx);
  }

  if (usable_(ctx, 'AUDIENCE')) {
    var arows = readTable_(ctx.audit.getSheetByName('AUDIENCE')).rows.filter(function (r) { return r['ID']; });
    var ar = latestBy_(arows, function (r) { return parseDateTime_(r['Snapshot']); });
    if (ar) {
      var a = audienceOf_(ar);
      var T = CONFIG.THRESHOLDS;
      var mark = function (v, min) { return v === null ? NOT_RECORDED : pct_(v) + (v >= min ? ' ✓' : ' ✗'); };
      lines['Latest audience'] = ar['ID'] + ' @ ' + (ar['Snapshot'] || NOT_RECORDED) + ': female ' + mark(a.female, T.audienceFemaleMin) +
        ', 45+ ' + mark(a.age45, T.audience45PlusMin) + ', US ' + mark(a.us, T.audienceUsMin) +
        (a.nonFollowers !== null ? ', non-followers ' + pct_(a.nonFollowers) : '');
    }
  }

  if (usable_(ctx, 'WEEKLY REVIEW')) {
    var wrows = readTable_(ctx.audit.getSheetByName('WEEKLY REVIEW')).rows.filter(function (r) { return r['Window']; });
    var w = latestBy_(wrows, function (r) { var p = parsePeriod_(r['Window']); return p ? p.end : null; });
    if (w) {
      var wv = parseNum_(w['Views']), pv = parseNum_(w['Profile views']), rw = parseNum_(w['Estimated rewards']);
      lines['Latest week'] = w['Window'] + ': ' + fmtInt_(wv) + ' views, ' + fmtInt_(pv) + ' profile views' +
        (wv && pv !== null ? ' (' + (pv / wv * 1000).toFixed(1) + ' per 1K views)' : '') +
        ', ' + fmtInt_(parseNum_(w['Shares'])) + ' shares, FYP ' + (w['FYP'] || NOT_RECORDED) + ', search ' + (w['Search'] || NOT_RECORDED) +
        '. Creator Rewards (est., separate from Shop commission): ' + (rw === null ? NOT_RECORDED : '$' + rw.toFixed(2)) +
        (w['Lesson / next decision'] ? '. Lesson: ' + w['Lesson / next decision'] : '');
    }
  }

  var waiting = function (sheetName, col) {
    return readTable_(mustSheet_(ctx.brain, sheetName)).rows.filter(function (r) {
      return !DECIDED_STATUS.test((r[col] || '').trim());
    }).length;
  };
  lines['Waiting for review'] = waiting(BRAIN.RECS, 'Review status') + ' recommendations · ' +
    waiting(BRAIN.APPROVALS, 'Status') + ' approvals · ' + waiting(BRAIN.RESEARCH, 'Status') + ' research items';

  if (ctx.docs && ctx.docs.length) {
    lines['Reference docs'] = ctx.docs.map(function (d) {
      return d.label + ': ' + (d.ok ? 'last edited ' + d.updated : 'unreadable (' + (d.error || 'unknown error') + ')');
    }).join(' · ');
  }

  lines['Data checks'] = (ctx.dataNotes.length ? ctx.dataNotes.join('; ') : 'no snapshot date problems found') +
    (ctx.warnings.length ? ' | Warnings: ' + ctx.warnings.length + ' (see CHANGE LOG)' : '');

  upsertAutoRows_(sh, lines);
}

/** Update or append "Auto · " rows (columns A:B only). Refuses to write over a non-Auto row. */
function upsertAutoRows_(sh, lines) {
  var values = sh.getDataRange().getDisplayValues();
  var rowOf = {};
  values.forEach(function (r, i) {
    var k = String(r[0] || '');
    if (k.indexOf(AUTO_PREFIX) === 0 && !rowOf[k]) rowOf[k] = i + 1;
  });
  var nextRow = sh.getLastRow() + 1;
  Object.keys(lines).forEach(function (k) {
    var key = AUTO_PREFIX + k;
    var row = rowOf[key];
    if (!row) { row = nextRow++; rowOf[key] = row; }
    var a = sh.getRange(row, 1, 1, 2).getDisplayValues()[0];
    var isEmpty = !String(a[0]).trim() && !String(a[1]).trim();
    if (String(a[0]) !== key && !isEmpty) throw new Error('TODAY BRIEFING row ' + row + ' is not an Auto row; refusing to overwrite it.');
    sh.getRange(row, 1, 1, 2).setValues([[key, lines[k]]]);
  });
}

/**
 * Latest TikTok Shop reporting period from SHOP KPI BASELINE, chosen by date:
 *   valid row = Scope in CONFIG.SHOP_PERIOD_SCOPES, "Period / date" is a date
 *   range, and at least one of GMV / items / clicks / commission is recorded.
 *   Latest = latest end date; ties → longest window (most complete).
 * Missing values are shown as "not recorded" (never 0). Shop commission is
 * never combined with Creator Rewards.
 */
function describeShopPeriod_(ctx) {
  var sh = ctx.audit.getSheetByName('SHOP KPI BASELINE');
  var all = readTable_(sh).rows;
  var scopes = CONFIG.SHOP_PERIOD_SCOPES.map(function (s) { return s.toLowerCase(); });
  var valid = all.filter(function (r) {
    if (scopes.indexOf(String(r['Scope'] || '').trim().toLowerCase()) === -1) return false;
    var p = parsePeriod_(r['Period / date']);
    if (!p || p.start === p.end) return false;
    r._period = p;
    return ['GMV USD', 'Attributed items', 'Product clicks', 'Est. commission USD'].some(function (c) { return parseNum_(r[c]) !== null; });
  });
  if (!valid.length) return 'No valid reporting period found (' + all.length + ' rows checked; need Scope "' + CONFIG.SHOP_PERIOD_SCOPES.join('" or "') + '" and a date range).';
  valid.sort(function (a, b) {
    if (a._period.end !== b._period.end) return b._period.end - a._period.end;
    return a._period.start - b._period.start;
  });
  var s = valid[0];
  var money = function (c) { var n = parseNum_(s[c]); return n === null ? NOT_RECORDED : '$' + n.toFixed(2); };
  var count = function (c) { var n = parseNum_(s[c]); return n === null ? NOT_RECORDED : fmtInt_(n); };
  return s['Period / date'] + ' (' + s['Scope'] + '): GMV ' + money('GMV USD') + ' (sales value, not earnings) · ' +
    count('Attributed items') + ' attributed items · ' + count('Product clicks') + ' product clicks · CTR ' +
    (s['Product card CTR'] || NOT_RECORDED) + ' · est. Shop commission ' + money('Est. commission USD') +
    ' · evidence: ' + (s['Evidence label'] || NOT_RECORDED) +
    '. Creator Rewards are tracked separately (WEEKLY REVIEW). [' + valid.length + ' reporting periods; ' +
    (all.length - valid.length) + ' informational rows ignored]';
}

// ───────────────────────────── Helpers ───────────────────────────────────

function getBrain_() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  return ss || SpreadsheetApp.openById(CONFIG.FALLBACK_IDS.brain);
}

function readIds_(brain) {
  var map = {};
  var sh = brain.getSheetByName(BRAIN.CONTROL);
  if (sh) sh.getDataRange().getDisplayValues().forEach(function (r) { map[String(r[0]).trim()] = String(r[1] || '').trim(); });
  var f = CONFIG.FALLBACK_IDS;
  return {
    audit:  map['Audit workbook ID'] || f.audit,
    brain:  map['Brain workbook ID'] || f.brain,
    octDoc: map['October playbook document ID'] || f.octDoc,
    novDoc: map['November reset document ID'] || f.novDoc
  };
}

function isApproved_(v) { return /^approved$/i.test(String(v || '').trim()); }

function ownedSheet_(sh, marker) {
  var a1 = String(sh.getRange(1, 1).getDisplayValues()[0][0] || '');
  return a1.indexOf(marker) === 0 || (sh.getLastRow() === 0);
}

/** Pads rows to the same width; returns the width. */
function padRows_(rows) {
  var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  rows.forEach(function (r) { while (r.length < width) r.push(''); });
  return width;
}

function ensureSize_(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

/** Set Value (col B) and optionally Status (col D) for a key in AI CONTROL CENTER. Pass null to leave a cell alone. */
function setControl_(brain, key, value, status) {
  var sh = brain.getSheetByName(BRAIN.CONTROL);
  if (!sh) return;
  var keys = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getDisplayValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) {
      if (value !== null && value !== undefined) sh.getRange(i + 1, 2).setValue(value);
      if (status !== null && status !== undefined) sh.getRange(i + 1, 4).setValue(status);
      return;
    }
  }
}

/** On success: clear Last error, but say when an earlier error was resolved. */
function clearLastError_(brain, now) {
  var sh = brain.getSheetByName(BRAIN.CONTROL);
  if (!sh) return;
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getDisplayValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === 'Last error') {
      var had = String(vals[i][1] || '').trim();
      sh.getRange(i + 1, 2).setValue('');
      sh.getRange(i + 1, 4).setValue(had ? 'Resolved ' + now + ' (details in CHANGE LOG)' : 'None');
      return;
    }
  }
}

function logChange_(brain, op, target, detail, outcome, error) {
  var sh = brain.getSheetByName(BRAIN.LOG);
  if (sh) sh.appendRow([nowUtc_(), op, target, detail, outcome, error || '']);
}

function mustSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Missing tab "' + name + '" in ' + ss.getName());
  return sh;
}

/** Table with header detection: the first of the top 3 rows that has 3+ filled cells. */
function readTable_(sheet) {
  if (!sheet) return { headers: [], rows: [], headerRow: 0 };
  return tableFromValues_(sheet.getDataRange().getDisplayValues());
}

function tableFromValues_(values) {
  var h = 0;
  for (var i = 0; i < Math.min(3, values.length); i++) {
    if (values[i].filter(function (c) { return String(c).trim() !== ''; }).length >= 3) { h = i; break; }
  }
  var headers = (values[h] || []).map(function (x) { return String(x).trim(); });
  var rows = [];
  for (var r = h + 1; r < values.length; r++) {
    var row = values[r];
    if (!row.some(function (c) { return String(c).trim() !== ''; })) continue;
    var o = { _row: r + 1 };
    headers.forEach(function (name, c) { if (name) o[name] = String(row[c] === undefined ? '' : row[c]).trim(); });
    rows.push(o);
  }
  return { headers: headers, rows: rows, headerRow: h + 1 };
}

/** Append a row, putting each value under its header name. */
function appendByHeaders_(sheet, obj) {
  var t = readTable_(sheet);
  var missing = Object.keys(obj).filter(function (k) { return t.headers.indexOf(k) === -1; });
  if (missing.length) throw new Error('Tab "' + sheet.getName() + '" is missing column(s): ' + missing.join(', '));
  sheet.appendRow(t.headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; }));
}

/** Row with the largest timestamp; rows without one lose to rows with one; ties → lower row. */
function latestBy_(rows, tsFn) {
  var best = null, bestTs = null;
  rows.forEach(function (r) {
    var ts = tsFn(r);
    if (!best) { best = r; bestTs = ts; return; }
    if (ts !== null && (bestTs === null || ts >= bestTs)) { best = r; bestTs = ts; }
    else if (ts === null && bestTs === null) { best = r; }
  });
  return best;
}

/** First "Nov 15[, 2026]" or "15 Nov [2026]" in s, or null. */
function findMonthDay_(s) {
  var re = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?/g, m;
  while ((m = re.exec(s))) {
    var mo = monthIdx_(m[1]);
    if (mo !== null) return { mo: mo, d: +m[2], y: m[3] ? +m[3] : null, text: m[0] };
  }
  re = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4})\b)?/g;
  while ((m = re.exec(s))) {
    var mo2 = monthIdx_(m[2]);
    if (mo2 !== null) return { mo: mo2, d: +m[1], y: m[3] ? +m[3] : null, text: m[0] };
  }
  return null;
}

function monthIdx_(name) {
  var k = String(name).slice(0, 3).toLowerCase();
  return MONTHS_.hasOwnProperty(k) ? MONTHS_[k] : null;
}

var MONTHS_ = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Parse a date and optional time from one or two strings into a sortable
 * number (ms, naive local time). Accepts 2026-11-15, 2026/11/15, 11/15/2026,
 * 11/15/26, 11/15, Nov 15, Nov 15 2026, November 15, 2026, 15 Nov 2026, plus
 * times like 18:21, 6:21 pm, 6pm. Returns null when no date can be found.
 */
function parseDateTime_(dateStr, timeStr, defaultYear) {
  var s = String(dateStr || '') + ' ' + String(timeStr || '');
  var year = defaultYear || new Date().getFullYear();
  var y = null, mo = null, d = null, m;
  if ((m = s.match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; s = s.replace(m[0], ' '); }
  else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    mo = +m[1] - 1; d = +m[2]; y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : year; s = s.replace(m[0], ' ');
  } else if ((m = findMonthDay_(s))) {
    mo = m.mo; d = m.d; y = m.y || year; s = s.replace(m.text, ' ');
  }
  if (y === null || mo === null || d === null || mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  var hh = 0, mi = 0;
  if ((m = s.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i))) {
    hh = +m[1]; mi = +m[2];
    if (m[3]) { var pm = /^p/i.test(m[3]); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  } else if ((m = s.match(/\b(\d{1,2})\s*(am|pm)\b/i))) {
    hh = +m[1] % 12 + (/pm/i.test(m[2]) ? 12 : 0);
  }
  return Date.UTC(y, mo, d, hh, mi);
}

/**
 * Parse a period like "2026-11-01 to 11-17", "2026-10-01 to 2026-10-31",
 * "Nov 7–Nov 13", "Nov 7-13". Returns {start, end} (ms) or null. A single
 * date returns start === end.
 */
function parsePeriod_(str) {
  var s = String(str || '').trim();
  if (!s) return null;
  var parts = s.split(/\s+to\s+|\s*[–—]\s*|\s+-\s+/i);
  var short = parts.length < 2 && s.match(/^([A-Za-z]{3,9}\.?\s+\d{1,2})-(\d{1,2})\b/); // "Nov 7-13"
  if (short) parts = [short[1], short[2]];
  var start = parseDateTime_(parts[0]);
  if (start === null) return null;
  if (parts.length < 2) return { start: start, end: start };
  var sd = new Date(start);
  var tail = parts[1].trim(), end = null, m;
  if ((m = tail.match(/^(\d{1,2})-(\d{1,2})$/))) end = Date.UTC(sd.getUTCFullYear(), +m[1] - 1, +m[2]);
  else if ((m = tail.match(/^(\d{1,2})$/))) end = Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), +m[1]);
  else end = parseDateTime_(tail, '', sd.getUTCFullYear());
  if (end === null || end < start) return null;
  return { start: start, end: end };
}

/** "48,600." → 48600 · "10.6K" → 10600 · "1.2M" → 1200000 · "" → null */
function parseNum_(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).trim().replace(/[$,\s]/g, '').replace(/\.$/, '');
  if (!s) return null;
  var m = s.match(/^(-?\d*\.?\d+)([kKmM])?%?$/);
  if (!m) return null;
  var n = parseFloat(m[1]);
  if (m[2]) n *= /k/i.test(m[2]) ? 1000 : 1000000;
  return n;
}

/** "73.0%" → 0.73 · 0.73 → 0.73 · 73 → 0.73 */
function parsePct_(v) {
  var n = parseNum_(v);
  if (n === null) return null;
  if (String(v).indexOf('%') !== -1 || n > 1) return n / 100;
  return n;
}

function pct_(x) { return Math.round(x * 1000) / 10 + '%'; }

function fmtInt_(n) {
  return n === null || n === undefined ? NOT_RECORDED : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function nowUtc_() {
  return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd HH:mm 'UTC'");
}
