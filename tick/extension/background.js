/*
 * Service worker: stores snapshots per account, drives the toolbar badge, and sends the
 * opt-out notifications (approaching a limit, limit reached, limit reset). It never talks to
 * claude.ai itself; the content script and popup do the reading.
 */
importScripts('shared/core.js', 'shared/api.js');
const Tick = self.Tick;

async function getSettings() {
  try {
    const { settings } = await chrome.storage.sync.get('settings');
    return { ...Tick.DEFAULT_SETTINGS, ...(settings || {}) };
  } catch (_) {
    return { ...Tick.DEFAULT_SETTINGS };
  }
}

/* ---------- install / update ---------- */

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings) await chrome.storage.sync.set({ settings: { ...Tick.DEFAULT_SETTINGS } });

  // Light up claude.ai tabs that were already open, so nobody has to reload.
  const files = (chrome.runtime.getManifest().content_scripts || [])[0]?.js || [];
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' }).catch(() => []);
  for (const t of tabs) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files }).catch(() => {});
  }
  if (reason === 'install' && !tabs.length) {
    chrome.tabs.create({ url: 'https://claude.ai/new' }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const { lastOrg } = await chrome.storage.local.get('lastOrg');
  if (!lastOrg) return;
  const snap = (await chrome.storage.local.get('snap:' + lastOrg))['snap:' + lastOrg];
  if (snap) updateBadge(snap, await getSettings());
});

/* ---------- messages ---------- */

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'snapshot') {
    onSnapshot(msg.snapshot, !!msg.passive).then(
      () => reply({ ok: true }),
      () => reply({ ok: false })
    );
    return true;
  }
  if (msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const { lastOrg } = await chrome.storage.local.get('lastOrg');
  const snap = lastOrg && (await chrome.storage.local.get('snap:' + lastOrg))['snap:' + lastOrg];
  updateBadge(snap || null, await getSettings());
});

// `passive` = read in the background for an account you're not currently looking at (the popup
// refreshing a second account). It's stored, but doesn't take over the badge.
async function onSnapshot(snap, passive = false) {
  if (!snap || snap.v !== 1 || !Tick.api.isOrgId(snap.orgId)) return;
  const { accounts = {}, lastOrg } = await chrome.storage.local.get(['accounts', 'lastOrg']);
  accounts[snap.orgId] = {
    orgId: snap.orgId,
    label: Tick.accountLabel(snap),
    plan: snap.plan ? snap.plan.label : null,
    isOrg: !!snap.isOrg,
    seenAt: Date.now()
  };
  const takeOver = !passive || !lastOrg || lastOrg === snap.orgId;
  await chrome.storage.local.set({ ['snap:' + snap.orgId]: snap, accounts, ...(takeOver ? { lastOrg: snap.orgId } : {}) });
  const settings = await getSettings();
  if (takeOver) await updateBadge(snap, settings);
  await checkNotifications(snap, settings);
}

/* ---------- badge ---------- */

const BADGE = { ok: '#C6613F', warn: '#B7800F', crit: '#D6453D', max: '#D6453D' };

async function updateBadge(snap, settings) {
  const r = settings.badge && snap ? Tick.primaryReading(snap) : null;
  if (!r) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: chrome.runtime.getManifest().name });
    return;
  }
  const pct = Math.round(r.pct);
  const sev = Tick.severity(r.pct);
  await chrome.action.setBadgeText({ text: pct >= 100 ? 'MAX' : String(pct) });
  await chrome.action.setBadgeBackgroundColor({ color: BADGE[sev] });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  const reset = r.resetsAt ? ` · resets in ${Tick.fmtDuration(r.resetsAt - Date.now())}` : '';
  await chrome.action.setTitle({ title: `${Tick.accountLabel(snap)} · ${r.label}: ${pct}% used${reset}` });
}

/* ---------- notifications ---------- */

function readings(snap) {
  const out = snap.mode === 'rate' ? snap.limits.map((l) => ({ id: l.id, label: l.label, pct: l.pct, resetsAt: l.resetsAt })) : [];
  if (snap.spend && snap.spend.pct != null) {
    out.push({
      id: 'spend',
      label: snap.mode === 'spend' ? 'Monthly spend' : 'Usage credits',
      pct: snap.spend.pct,
      resetsAt: snap.spend.resetsAt,
      money: true
    });
  }
  return out;
}

function notify(id, title, message) {
  Promise.resolve(chrome.notifications.create(id, { type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 1 })).catch(() => {});
}

async function checkNotifications(snap, settings) {
  const { notified = {} } = await chrome.storage.local.get('notified');
  const who = snap.isOrg ? ` (${Tick.accountLabel(snap)})` : '';
  const now = Date.now();
  let changed = false;

  for (const r of readings(snap)) {
    // One notice per limit per window: key on the reset time, bucketed to absorb tiny jitter.
    const win = `${snap.orgId}|${r.id}|${r.resetsAt ? Math.round(r.resetsAt / 600e3) : 'x'}`;
    const when = r.resetsAt ? Tick.fmtDayClock(r.resetsAt, now) : null;

    if (r.pct >= 100 && !notified[win + '|max']) {
      notify(`max|${win}`, `${r.label} limit reached${who}`, when ? `Resets ${when} (in ${Tick.fmtDuration(r.resetsAt - now)}).` : 'You’ve hit this limit.');
      notified[win + '|max'] = now;
      notified[win + '|warn'] = now;
      changed = true;
    } else if (settings.warnAt > 0 && r.pct >= settings.warnAt && r.pct < 100 && !notified[win + '|warn']) {
      const lbl = /^[A-Z][a-z]+ weekly$/.test(r.label) ? r.label : r.label.toLowerCase(); // keep model names capitalized
      notify(`warn|${win}`, `${Math.round(r.pct)}% of your ${lbl} limit used${who}`, when ? `Resets ${when} (in ${Tick.fmtDuration(r.resetsAt - now)}).` : 'Heads up before you hit the cap.');
      notified[win + '|warn'] = now;
      changed = true;
    }

    // Tell people when a limit they were close to frees up again.
    const threshold = settings.warnAt > 0 ? settings.warnAt : 90;
    if (settings.notifyReset && !r.money && r.resetsAt && r.resetsAt > now && r.pct >= threshold) {
      chrome.alarms.create(`reset|${snap.orgId}|${r.id}|${Math.round(r.resetsAt / 60e3)}|${encodeURIComponent(r.label)}|${encodeURIComponent(who)}`, { when: r.resetsAt + 15e3 });
    }
  }

  if (changed) {
    const keys = Object.keys(notified);
    if (keys.length > 300) keys.sort((a, b) => notified[a] - notified[b]).slice(0, keys.length - 300).forEach((k) => delete notified[k]);
    await chrome.storage.local.set({ notified });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('reset|')) return;
  const [, , , , label, who] = alarm.name.split('|');
  const settings = await getSettings();
  if (!settings.notifyReset) return;
  notify(alarm.name, `${decodeURIComponent(label)} limit reset${decodeURIComponent(who)}`, 'You’re back to full capacity on this limit.');
});

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  const [tab] = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: 'https://claude.ai/new' });
  }
});
