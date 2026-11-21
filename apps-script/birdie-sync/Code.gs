/**
 * Birdie Brain ⇄ Becky in Midlife Audit — two-way sync
 * ----------------------------------------------------
 * Install in: Birdie Brain | AI Editing & Marketing Playbook | Live
 *             (Extensions › Apps Script, paste this file as Code.gs)
 *
 * What it does on each run (daily trigger + "Birdie Sync" menu):
 *
 *   AUDIT ➜ BRAIN (performance facts)
 *     • Fingerprints each watched Audit tab; only changed tabs are processed.
 *       Every change is logged in SYNC SNAPSHOTS.
 *     • Runs fixed, rule-based checks on the changed data (follow rate,
 *       3-second retention, missing follows, finished tests). Results go to
 *       AI RECOMMENDATIONS / RESEARCH QUEUE as "Pending review". Nothing is
 *       promoted to a rule on its own.
 *     • Copies results Becky enters in Audit › CREATIVE TESTS for AUTO-
 *       experiments back to AI RECOMMENDATIONS › Decision / notes.
 *     • Refreshes the "Auto ·" rows in TODAY BRIEFING. Rows Becky typed
 *       herself are never touched.
 *
 *   BRAIN ➜ AUDIT (approved knowledge)
 *     • Rewrites one script-owned tab in the Audit workbook, BIRDIE SYNC,
 *       with the current Brand rules, Video editing rules and anything
 *       marked Approved in APPROVAL QUEUE / AI RECOMMENDATIONS.
 *     • Approved AI RECOMMENDATIONS are added once to Audit › CREATIVE
 *       TESTS as a "Planned" row (ID = AUTO-xxxxxxxx) so they show up in
 *       the test log.
 *
 *   REFERENCE DOCS (read-only)
 *     • October Playbook and November Reset are read and fingerprinted only.
 *       If either changes, a RESEARCH QUEUE item asks for a human review of
 *       the rules sourced from it. The Docs are never written to.
 *
 * No AI or paid API calls are made. AI analysis mode stays OFF.
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

  // Daily trigger hour, in the Apps Script project's time zone.
  DAILY_HOUR: 6,

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

  // Script-owned tab created in the Audit workbook. Never watched.
  MIRROR_TAB: 'BIRDIE SYNC',

  // Script-owned tab created in Birdie Brain.
  KNOWLEDGE_MIRROR_TAB: 'AUDIT KNOWLEDGE',

  THRESHOLDS: {
    minViewsForRate: 1000,     // don't judge follow rate below this many views
    followsPer1kLow: 1.0,      // flag follow conversion below this
    threeSecRetentionLow: 0.70, // flag 3-sec retention below 70%
    // Audience fit (Gen X midlife women, US). Flagged when a reading falls below.
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

var AUTO_PREFIX = 'Auto · ';
var PUSHED_NEXT_ACTION = 'Record result here; it syncs back to Birdie Brain';

// ───────────────────────────── Entry points ──────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Birdie Sync')
    .addItem('Run sync now', 'refreshBirdieBrain')
    .addItem('Install / repair daily trigger', 'installBirdieTrigger')
    .addItem('Turn off automatic sync', 'removeBirdieTriggers')
    .addToUi();
}

/**
 * Main job. Run once by hand to authorize. That first run also installs
 * the daily trigger if there isn't one yet.
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
      stats: { changedTabs: [], recs: 0, research: 0, pushedTests: 0, resultsBack: 0, docsChanged: [],
               proposals: 0, rulesAdded: 0, knowledgeMirrored: false }
    };

    // Audit ➜ Brain
    ctx.stats.changedTabs = snapshotAuditTabs_(ctx);
    ctx.docs = snapshotReferenceDocs_(ctx);
    if (ctx.stats.changedTabs.length) runAuditRules_(ctx);
    syncTestResultsBack_(ctx);
    mirrorAuditKnowledge_(ctx);
    proposeNewKnowledge_(ctx);
    promoteApprovedKnowledge_(ctx);
    indexReferenceTabs_(ctx);

    // Brain ➜ Audit
    pushApprovedToAudit_(ctx);

    updateBriefing_(ctx);
    ensureTrigger_();

    setControl_(brain, 'System status', 'ACTIVE', 'Sync running');
    setControl_(brain, 'Refresh frequency', null, 'Active');
    setControl_(brain, 'Last refresh UTC', ctx.now, 'OK');
    setControl_(brain, 'Last error', '', 'None');

    var s = ctx.stats;
    logChange_(brain, 'refresh', 'Audit ⇄ Brain',
      'Changed tabs: ' + (s.changedTabs.join(', ') || 'none') +
      ' | docs changed: ' + (s.docsChanged.join(', ') || 'none') +
      ' | new recs: ' + s.recs + ' | research items: ' + s.research +
      ' | tests pushed: ' + s.pushedTests + ' | results synced back: ' + s.resultsBack +
      ' | knowledge proposals: ' + s.proposals + ' | rules added: ' + s.rulesAdded +
      ' | AUDIT KNOWLEDGE ' + (s.knowledgeMirrored ? 'refreshed' : 'unchanged'),
      'OK', '');
  } catch (err) {
    var msg = String(err && err.stack ? err.stack : err);
    try {
      setControl_(brain, 'Last error', nowUtc_() + ' — ' + String(err), 'Error');
      setControl_(brain, 'System status', 'ERROR', 'See Last error / CHANGE LOG');
      logChange_(brain, 'refresh', 'Audit ⇄ Brain', 'Sync failed', 'FAILED', msg.slice(0, 1000));
    } catch (ignored) {}
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function installBirdieTrigger() {
  removeBirdieTriggers(true);
  ScriptApp.newTrigger('refreshBirdieBrain')
    .timeBased().everyDays(1).atHour(CONFIG.DAILY_HOUR).create();
  var brain = getBrain_();
  setControl_(brain, 'Refresh frequency', 'Daily (~' + CONFIG.DAILY_HOUR + ':00 script time)', 'Active');
  logChange_(brain, 'trigger', 'refreshBirdieBrain', 'Daily trigger installed', 'OK', '');
}

function removeBirdieTriggers(silent) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshBirdieBrain') ScriptApp.deleteTrigger(t);
  });
  if (silent === true) return;
  var brain = getBrain_();
  setControl_(brain, 'Refresh frequency', null, 'Not active');
  setControl_(brain, 'System status', 'PAUSED', 'Automatic sync turned off');
  logChange_(brain, 'trigger', 'refreshBirdieBrain', 'Daily trigger removed', 'OK', '');
}

function ensureTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'refreshBirdieBrain';
  });
  if (!has) installBirdieTrigger();
}

// ───────────────────────────── Audit ➜ Brain ─────────────────────────────

/** Fingerprint watched Audit tabs and return the names of the ones that changed. */
function snapshotAuditTabs_(ctx) {
  var changed = [];
  var snapSheet = mustSheet_(ctx.brain, BRAIN.SNAPSHOTS);
  CONFIG.AUDIT_TABS_WATCHED.forEach(function (name) {
    var sh = ctx.audit.getSheetByName(name);
    if (!sh) return;
    var values = sh.getDataRange().getDisplayValues();
    var digest = sha256_(JSON.stringify(values));
    var key = 'digest:audit:' + name;
    var prev = ctx.props.getProperty(key);
    if (prev === digest) return;

    var table = tableFromValues_(values);
    var last = table.rows.length ? table.rows[table.rows.length - 1] : null;
    var sample = last ? table.headers.slice(0, 4).map(function (h) { return last[h]; })
      .filter(String).join(' | ') : '(no data rows)';
    snapSheet.appendRow([ctx.now, 'Audit › ' + name, table.rows.length, digest, sample.slice(0, 300),
      prev ? 'Changed since last sync' : 'Baseline (first sync)']);
    ctx.props.setProperty(key, digest);
    changed.push(name);
  });
  return changed;
}

/** Read-only fingerprint of both reference Docs. Never writes to them. */
function snapshotReferenceDocs_(ctx) {
  var docs = [
    { id: ctx.ids.octDoc, label: 'October Creator Marketing Master Playbook' },
    { id: ctx.ids.novDoc, label: 'November TikTok Master Reset' }
  ];
  var snapSheet = mustSheet_(ctx.brain, BRAIN.SNAPSHOTS);
  var research = mustSheet_(ctx.brain, BRAIN.RESEARCH);
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
        snapSheet.appendRow([ctx.now, 'Doc › ' + d.label, info.words + ' words', digest,
          'Last edited ' + info.updated, prev ? 'Reference changed — review only' : 'Baseline (first sync)']);
        if (prev) {
          research.appendRow([ctx.now,
            'Reference doc updated: ' + d.label + '. Check whether BRAND RULES / VIDEO EDITING RULES that cite it need revising. Nothing was changed automatically.',
            info.url, '', 'BRAND BRIEF', 'Rules sourced from this doc may now be out of date', 'Pending review',
            'Doc last edited ' + info.updated]);
          ctx.stats.research++;
          ctx.stats.docsChanged.push(d.label);
        }
        ctx.props.setProperty(key, digest);
      }
    } catch (e) {
      info.error = String(e);
      logChange_(ctx.brain, 'read-doc', d.label, 'Could not read reference doc', 'WARNING', String(e));
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

/** Rule-based observations. Every result waits for review; nothing becomes a rule automatically. */
function runAuditRules_(ctx) {
  var T = CONFIG.THRESHOLDS;
  var recSheet = mustSheet_(ctx.brain, BRAIN.RECS);
  var recTable = readTable_(recSheet);
  var existing = {};
  recTable.rows.forEach(function (r) { if (r['Proposal ID']) existing[r['Proposal ID']] = true; });

  function addRec(ruleKey, problem, experiment, evidence, sources, metric) {
    var id = 'AUTO-' + sha256_(ruleKey).slice(0, 8);
    if (existing[id]) return;
    existing[id] = true;
    appendByHeaders_(recSheet, {
      'Created UTC': ctx.now,
      'Proposal ID': id,
      'Problem or observation': problem,
      'Recommended experiment': experiment,
      'Evidence level': evidence,
      'Source references': sources,
      'Success metric': metric,
      'Review status': 'Pending review',
      'Decision / notes': ''
    });
    ctx.stats.recs++;
  }

  var changed = {};
  ctx.stats.changedTabs.forEach(function (n) { changed[n] = true; });

  // Follow conversion: latest SNAPSHOT per post (official source); POST LOG fills in when a post has no snapshot.
  if (changed['SNAPSHOTS'] || changed['POST LOG']) {
    var latest = latestReadings_(ctx.audit);
    Object.keys(latest).forEach(function (pid) {
      var r = latest[pid];
      if (r.views === null || r.views < T.minViewsForRate) return;
      if (r.follows === null) {
        addRec('missing-follows|' + pid,
          pid + ' has ' + fmtInt_(r.views) + ' views (' + r.where + ') but no Follows recorded (PENDING).',
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
          'Follows / 1K views above ' + T.followsPer1kLow + ' at a comparable reading');
      }
    });
  }

  // Hook retention.
  if (changed['RETENTION']) {
    readTable_(ctx.audit.getSheetByName('RETENTION')).rows.forEach(function (r) {
      var pid = r['ID']; var ret = parsePct_(r['3-sec retention']);
      if (!pid || ret === null || ret >= T.threeSecRetentionLow) return;
      addRec('low-3s-retention|' + pid,
        pid + ' kept ' + Math.round(ret * 100) + '% of viewers at 3 seconds (snapshot ' + (r['Snapshot'] || '?') +
        '; largest drop ' + (r['Largest drop'] || '?') + ') (OBSERVED).',
        'Recut the first 2–3 seconds with a specific recognition hook and a visual that works without sound (ED-02). Keep the rest the same.',
        'HYPOTHESIS', 'Audit › RETENTION; ED-02; BR-06', '3-sec retention ≥ ' + Math.round(T.threeSecRetentionLow * 100) + '%');
    });
  }

  // Audience fit.
  if (changed['AUDIENCE']) {
    readTable_(ctx.audit.getSheetByName('AUDIENCE')).rows.forEach(function (r) {
      var pid = r['ID']; if (!pid) return;
      var a = audienceOf_(r);
      var misses = [];
      if (a.female !== null && a.female < T.audienceFemaleMin) misses.push('female ' + pct_(a.female) + ' (target ≥ ' + pct_(T.audienceFemaleMin) + ')');
      if (a.age45 !== null && a.age45 < T.audience45PlusMin) misses.push('age 45+ ' + pct_(a.age45) + ' (target ≥ ' + pct_(T.audience45PlusMin) + ')');
      if (a.us !== null && a.us < T.audienceUsMin) misses.push('US ' + pct_(a.us) + ' (target ≥ ' + pct_(T.audienceUsMin) + ')');
      if (!misses.length) return;
      addRec('audience-drift|' + pid + '|' + (r['Snapshot'] || ''),
        pid + ' audience at ' + (r['Snapshot'] || '?') + ' is off target: ' + misses.join('; ') + ' (OBSERVED).',
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

  if (changed['CREATIVE TESTS']) {
    readTable_(ctx.audit.getSheetByName('CREATIVE TESTS')).rows.forEach(function (r) {
      var id = r['Test']; var result = (r['Result'] || '').trim();
      if (!id || !result || /^pending$/i.test(result)) return;
      addResearch('creative-test|' + id + '|' + result,
        'Creative test ' + id + ' result: ' + result + (r['Decision'] ? ' — decision: ' + r['Decision'] : '') +
        '. Hypothesis: ' + (r['Hypothesis'] || '?'),
        auditUrl, 'Decide whether this stays a single result or becomes a rule (BR-11: don\'t promote a hypothesis on its own).');
    });
  }
  if (changed['SHOP CREATIVE TESTS']) {
    readTable_(ctx.audit.getSheetByName('SHOP CREATIVE TESTS')).rows.forEach(function (r) {
      var id = r['ID']; var status = (r['Status'] || '').trim();
      if (!id || !/(complete|done|result|won|lost|winner|confirmed)/i.test(status)) return;
      addResearch('shop-test|' + id + '|' + status,
        'Shop test ' + id + ' (' + (r['Category'] || '') + ') is now "' + status + '": ' + (r['Evidence / claim'] || ''),
        auditUrl, 'Review it against BR-10 (authentic commerce) before changing any commerce rule.');
    });
  }
}

/** Latest reading per post: SNAPSHOTS first (source of truth), POST LOG fills in missing posts. */
function latestReadings_(audit) {
  var out = {};
  var snaps = audit.getSheetByName('SNAPSHOTS');
  if (snaps) {
    readTable_(snaps).rows.forEach(function (r) {
      var pid = r['ID']; if (!pid) return;
      var hours = parseNum_(r['Hours after post']);
      var prev = out[pid];
      if (prev && hours !== null && prev.hours !== null && hours < prev.hours) return;
      out[pid] = { views: parseNum_(r['Views']), follows: parseNum_(r['Follows']), hours: hours,
        where: 'SNAPSHOTS', when: [r['Date'], r['Time']].filter(String).join(' ') };
    });
  }
  var log = audit.getSheetByName('POST LOG');
  if (log) {
    readTable_(log).rows.forEach(function (r) {
      var pid = r['ID']; if (!pid || out[pid]) return;
      out[pid] = { views: parseNum_(r['Views']), follows: parseNum_(r['Follows']), hours: null,
        where: 'POST LOG', when: r['Posted date'] || '' };
    });
  }
  return out;
}

/** Copy results Becky entered in Audit › CREATIVE TESTS for AUTO- experiments back into AI RECOMMENDATIONS. */
function syncTestResultsBack_(ctx) {
  var tests = ctx.audit.getSheetByName('CREATIVE TESTS');
  if (!tests) return;
  var results = {};
  readTable_(tests).rows.forEach(function (r) {
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
  if (notesCol === -1) return;
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

  var rows = [['AUDIT KNOWLEDGE — copied from the Audit workbook by the Birdie Brain Apps Script. Don\'t edit here: this tab is overwritten whenever a source tab changes. Edit the Audit workbook instead.',
    'Last copied: ' + ctx.now]];
  var bands = [];
  CONFIG.KNOWLEDGE_TABS.forEach(function (name) {
    var sh = ctx.audit.getSheetByName(name);
    rows.push(['']);
    if (!sh) { rows.push([name + ' — tab not found in Audit workbook']); return; }
    var t = readTable_(sh);
    var cols = t.headers.filter(String);
    bands.push(rows.length + 1);
    rows.push([name + ' (' + t.rows.length + ' rows) — ' + 'https://docs.google.com/spreadsheets/d/' + ctx.ids.audit + '/edit#gid=' + sh.getSheetId()]);
    rows.push(cols);
    t.rows.forEach(function (r) { rows.push(cols.map(function (c) { return r[c] || ''; })); });
  });
  var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  rows = rows.map(function (r) { while (r.length < width) r.push(''); return r; });

  target = target || ctx.brain.insertSheet(CONFIG.KNOWLEDGE_MIRROR_TAB);
  target.clear();
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
  var idCol = t.headers[0];
  var id = r[idCol];
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
  var newProps = {};

  CONFIG.PROPOSE_FROM_TABS.forEach(function (tab) {
    var sh = ctx.audit.getSheetByName(tab);
    if (!sh) return;
    var baselineKey = 'baseline:knowledge:' + tab;
    var firstSync = !all[baselineKey];
    if (!firstSync && ctx.stats.changedTabs.indexOf(tab) === -1) return;

    var t = readTable_(sh);
    t.rows.forEach(function (r) {
      var rowId = knowledgeRowId_(tab, t, r);
      var pid = 'KNOW-' + sha256_(tab + '|' + rowId).slice(0, 8);
      var seenKey = 'seen:' + pid;
      if (all[seenKey] || queued[pid]) return;
      newProps[seenKey] = '1';
      if (firstSync && !CONFIG.QUEUE_EXISTING_KNOWLEDGE_ON_FIRST_SYNC) return;
      var d = describeKnowledge_(tab, r);
      appendByHeaders_(queue, {
        'Created UTC': ctx.now,
        'Proposal ID': pid,
        'Proposed change': d.change,
        'Source / reasoning': 'Audit › ' + tab + ' › ' + rowId + (d.why ? ' — ' + d.why : ''),
        'Status': 'Pending review',
        'Reviewed by': '', 'Reviewed at': '',
        'Notes': 'Approve to add to VIDEO EDITING RULES as ' + rowId + '. Reject to leave it in the Audit workbook only.'
      });
      queued[pid] = true;
      ctx.stats.proposals++;
    });
    if (firstSync) newProps[baselineKey] = ctx.now;
  });
  if (Object.keys(newProps).length) ctx.props.setProperties(newProps);
}

/** Approved KNOW- proposals become VIDEO EDITING RULES rows (once each). */
function promoteApprovedKnowledge_(ctx) {
  var queue = readTable_(mustSheet_(ctx.brain, BRAIN.APPROVALS));
  var approved = queue.rows.filter(function (r) {
    return /^KNOW-/.test(r['Proposal ID'] || '') && /^\s*approved/i.test(r['Status'] || '');
  });
  if (!approved.length) return;
  var rulesSheet = mustSheet_(ctx.brain, BRAIN.EDITING);
  var rules = readTable_(rulesSheet);
  var have = {};
  rules.rows.forEach(function (r) { have[r[rules.headers[0]]] = true; });
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
  var sh = ctx.brain.getSheetByName(BRAIN.SOURCES);
  if (!sh) return;
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

  var isApproved = function (v) { return /^\s*approved/i.test(v || ''); };
  var approvedChanges = approvals.rows.filter(function (r) { return isApproved(r['Status']); });
  var approvedRecs = recs.rows.filter(function (r) { return isApproved(r['Review status']); });

  // 1) Script-owned mirror tab.
  var rows = [];
  rows.push(['BIRDIE SYNC — written by the Birdie Brain Apps Script. Don\'t edit here: this tab is overwritten on every sync. Make changes in Birdie Brain.', 'Last pushed: ' + ctx.now]);
  rows.push(['']);
  var section = function (title, table, cols, list) {
    rows.push([title + ' (' + list.length + ')']);
    rows.push(cols);
    if (!list.length) rows.push(['— none yet —']);
    list.forEach(function (r) { rows.push(cols.map(function (c) { return r[c] || ''; })); });
    rows.push(['']);
  };
  section('APPROVED BRAND RULES', brand, brand.headers.filter(String), brand.rows.filter(function (r) { return r[brand.headers[0]]; }));
  section('APPROVED VIDEO EDITING RULES', editing, editing.headers.filter(String), editing.rows.filter(function (r) { return r[editing.headers[0]]; }));
  section('APPROVED CHANGES (from APPROVAL QUEUE)', approvals, approvals.headers.filter(String), approvedChanges);
  section('APPROVED EXPERIMENTS (from AI RECOMMENDATIONS)', recs, recs.headers.filter(String), approvedRecs);

  var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  rows = rows.map(function (r) { while (r.length < width) r.push(''); return r; });

  var mirror = ctx.audit.getSheetByName(CONFIG.MIRROR_TAB) || ctx.audit.insertSheet(CONFIG.MIRROR_TAB);
  mirror.clear();
  mirror.getRange(1, 1, rows.length, width).setValues(rows);
  mirror.setFrozenRows(1);
  rows.forEach(function (r, i) {
    if (/^APPROVED /.test(r[0])) mirror.getRange(i + 1, 1, 1, width).setFontWeight('bold').setBackground('#FFF4D6');
  });
  mirror.getRange(1, 1, 1, width).setFontWeight('bold');

  // 2) Approved experiments are added to the Audit test log once each.
  if (!CONFIG.APPEND_APPROVED_TO_CREATIVE_TESTS || !approvedRecs.length) return;
  var tests = ctx.audit.getSheetByName('CREATIVE TESTS');
  if (!tests) return;
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

function updateBriefing_(ctx) {
  var sh = mustSheet_(ctx.brain, BRAIN.BRIEFING);
  var lines = {};

  lines['Last sync (UTC)'] = ctx.now + (ctx.stats.changedTabs.length
    ? ' — changed: ' + ctx.stats.changedTabs.join(', ') : ' — no Audit changes since last sync');

  var log = ctx.audit.getSheetByName('POST LOG');
  if (log) {
    var posts = readTable_(log).rows.filter(function (r) { return r['ID'] && r['Posted date']; });
    posts.sort(function (a, b) { return String(a['Posted date']).localeCompare(String(b['Posted date'])); });
    var p = posts[posts.length - 1];
    if (p) lines['Latest logged post'] = p['ID'] + ' · ' + p['Posted date'] + ' · ' + (p['Topic'] || '') +
      ' · ' + fmtInt_(parseNum_(p['Views'])) + ' views · job: ' + (p['Job'] || '?');
  }

  var readings = latestReadings_(ctx.audit);
  var rated = Object.keys(readings).map(function (pid) {
    var r = readings[pid];
    return (r.views && r.follows !== null) ? { pid: pid, rate: r.follows / r.views * 1000, r: r } : null;
  }).filter(Boolean);
  if (rated.length) {
    rated.sort(function (a, b) { return b.r.views - a.r.views; });
    lines['Follow rate (largest post)'] = rated.slice(0, 3).map(function (x) {
      return x.pid + ' ' + x.rate.toFixed(2) + '/1K at ' + fmtInt_(x.r.views) + ' views (' + x.r.where + (x.r.when ? ' ' + x.r.when : '') + ')';
    }).join('; ');
  }

  var shop = ctx.audit.getSheetByName('SHOP KPI BASELINE');
  if (shop) {
    var srows = readTable_(shop).rows.filter(function (r) { return r['Period / date']; });
    var s = srows[srows.length - 1];
    if (s) lines['Latest Shop period'] = s['Period / date'] + ': GMV $' + (s['GMV USD'] || '?') + ', ' +
      (s['Attributed items'] || '?') + ' items, ' + (s['Product clicks'] || '?') + ' clicks, CTR ' +
      (s['Product card CTR'] || '?') + ', est. commission $' + (s['Est. commission USD'] || '?') + ' (' + (s['Evidence label'] || 'unlabeled') + ')';
  }

  var aud = ctx.audit.getSheetByName('AUDIENCE');
  if (aud) {
    var arows = readTable_(aud).rows.filter(function (r) { return r['ID']; });
    var ar = arows[arows.length - 1];
    if (ar) {
      var a = audienceOf_(ar);
      var T = CONFIG.THRESHOLDS;
      var mark = function (v, min) { return v === null ? '?' : pct_(v) + (v >= min ? ' ✓' : ' ✗'); };
      lines['Latest audience'] = ar['ID'] + ' @ ' + (ar['Snapshot'] || '?') + ': female ' + mark(a.female, T.audienceFemaleMin) +
        ', 45+ ' + mark(a.age45, T.audience45PlusMin) + ', US ' + mark(a.us, T.audienceUsMin) +
        (a.nonFollowers !== null ? ', non-followers ' + pct_(a.nonFollowers) : '');
    }
  }

  var wk = ctx.audit.getSheetByName('WEEKLY REVIEW');
  if (wk) {
    var wrows = readTable_(wk).rows.filter(function (r) { return r['Window']; });
    var w = wrows[wrows.length - 1];
    if (w) {
      var wv = parseNum_(w['Views']), pv = parseNum_(w['Profile views']);
      lines['Latest week'] = w['Window'] + ': ' + fmtInt_(wv) + ' views, ' + fmtInt_(pv) + ' profile views' +
        (wv && pv !== null ? ' (' + (pv / wv * 1000).toFixed(1) + ' per 1K views)' : '') +
        ', ' + fmtInt_(parseNum_(w['Shares'])) + ' shares, FYP ' + (w['FYP'] || '?') + ', search ' + (w['Search'] || '?') +
        (w['Lesson / next decision'] ? '. Lesson: ' + w['Lesson / next decision'] : '');
    }
  }

  var pending = function (sheetName, col) {
    return readTable_(mustSheet_(ctx.brain, sheetName)).rows.filter(function (r) {
      var v = (r[col] || '').trim(); return !v || /pending/i.test(v);
    }).length;
  };
  lines['Waiting for review'] = pending(BRAIN.RECS, 'Review status') + ' recommendations · ' +
    pending(BRAIN.APPROVALS, 'Status') + ' approvals · ' + pending(BRAIN.RESEARCH, 'Status') + ' research items';

  if (ctx.docs && ctx.docs.length) {
    lines['Reference docs'] = ctx.docs.map(function (d) {
      return d.label + ': ' + (d.ok ? 'last edited ' + d.updated : 'unreadable (' + (d.error || '?') + ')');
    }).join(' · ');
  }

  // Upsert "Auto · " rows; leave Becky's typed rows alone.
  var values = sh.getDataRange().getDisplayValues();
  var rowOf = {};
  values.forEach(function (r, i) { if (r[0]) rowOf[r[0]] = i + 1; });
  var nextRow = sh.getLastRow() + 1;
  Object.keys(lines).forEach(function (k) {
    var key = AUTO_PREFIX + k;
    var row = rowOf[key];
    if (!row) { row = nextRow++; rowOf[key] = row; }
    sh.getRange(row, 1, 1, 2).setValues([[key, lines[k]]]);
  });
  sh.getRange(1, 2).setValue('Manual rows seeded Nov 20 2026; "Auto ·" rows refreshed ' + ctx.now);
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

/** Append a row, putting each value under its header name. Unknown keys are ignored. */
function appendByHeaders_(sheet, obj) {
  var t = readTable_(sheet);
  var row = t.headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  if (!row.length) row = Object.keys(obj).map(function (k) { return obj[k]; });
  sheet.appendRow(row);
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
  return n === null || n === undefined ? '?' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function nowUtc_() {
  return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd HH:mm 'UTC'");
}
