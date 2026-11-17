/*
 * Orchestrator for claude.ai tabs: works out which account is active, reads its usage from
 * claude.ai's own endpoints, keeps it fresh while you chat, and hands snapshots to the meter
 * and the background worker.
 *
 * Freshness strategy, cheapest first:
 *   - instant paint from the last snapshot cached for this account
 *   - refresh after each message (detected passively from the page's resource timing, so no
 *     script is injected into claude.ai and its requests are never touched)
 *   - refresh at each limit's reset time, on tab focus, and every 60s while the tab is visible
 *   - exponential backoff on errors, longer pauses on 401/403/429
 */
(function (root) {
  'use strict';
  const Tick = root.Tick;
  if (!Tick || root.__tickStarted) return;
  root.__tickStarted = true;

  const api = Tick.api.client('');
  const POLL_MS = 60e3;
  const ORGS_TTL = 6 * 3600e3;

  const state = {
    orgId: null,
    orgs: null,
    orgsAt: 0,
    snap: null,
    inflight: null,
    queued: false,
    failures: 0,
    backoffUntil: 0,
    spendCache: {},
    burst: [],
    resetTimer: null,
    settings: { ...Tick.DEFAULT_SETTINGS },
    timers: []
  };

  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  // After the extension is reloaded or updated, this copy of the script is orphaned: its
  // chrome.* calls throw. Tear down quietly instead of spamming errors into claude.ai's console.
  let dead = false;
  function shutdown() {
    if (dead) return;
    dead = true;
    state.timers.forEach(clearInterval);
    clearTimeout(state.resetTimer);
    state.burst.forEach(clearTimeout);
    mo && mo.disconnect();
    themeMo && themeMo.disconnect();
    po && po.disconnect();
    meter.destroy();
    root.__tickStarted = false;
  }

  function send(msg) {
    if (!alive()) return shutdown();
    try {
      return chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) {
      shutdown();
    }
  }

  const meter = new Tick.Meter({
    onRefresh: () => refresh({ force: true }),
    onOptions: () => send({ type: 'openOptions' })
  });
  meter.onTheme = (theme) => alive() && chrome.storage.local.set({ theme }).catch(() => {});

  /* ---------- account ---------- */

  function cookieOrg() {
    const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    let v = null;
    try {
      v = m ? decodeURIComponent(m[1]) : null;
    } catch (_) {}
    return Tick.api.isOrgId(v) ? v : null;
  }

  async function orgList(force) {
    if (!force && state.orgs && Date.now() - state.orgsAt < ORGS_TTL) return state.orgs;
    const list = await api.organizations();
    state.orgs = Array.isArray(list) ? list : [];
    state.orgsAt = Date.now();
    return state.orgs;
  }

  async function resolveAccount() {
    let id = cookieOrg();
    let orgs = null;
    try {
      orgs = await orgList(false);
      // Joined a new org since we cached the list.
      if (id && !orgs.some((o) => o.uuid === id)) orgs = await orgList(true);
    } catch (e) {
      if (!id) throw e; // can still read usage with the cookie alone; plan label just goes missing
    }
    if (!id && orgs && orgs.length) {
      const pick = orgs.find((o) => Array.isArray(o.capabilities) && o.capabilities.includes('chat')) || orgs[0];
      id = pick && Tick.api.isOrgId(pick.uuid) ? pick.uuid : null;
    }
    const org = (orgs && orgs.find((o) => o.uuid === id)) || null;
    return { id, org };
  }

  async function switchTo(id) {
    state.orgId = id;
    state.snap = null;
    state.spendCache = {};
    state.failures = 0;
    state.backoffUntil = 0;
    let cached = null;
    try {
      cached = (await chrome.storage.local.get('snap:' + id))['snap:' + id] || null;
    } catch (_) {}
    if (state.orgId !== id) return;
    if (cached && cached.v === 1) {
      state.snap = cached;
      meter.setSnapshot(cached);
      meter.setStatus({ state: 'ok' });
    } else {
      meter.setSnapshot(null);
      meter.setStatus({ state: 'loading' });
    }
  }

  /* ---------- refresh ---------- */

  function refresh({ force = false } = {}) {
    if (dead) return;
    if (!alive()) return shutdown();
    if (state.inflight) {
      if (force) state.queued = true;
      return state.inflight;
    }
    if (!force && Date.now() < state.backoffUntil) return;
    meter.setRefreshing(true);
    state.inflight = (async () => {
      try {
        const { id, org } = await resolveAccount();
        if (!id) {
          meter.setSnapshot(null);
          meter.setStatus({ state: 'signedout' });
          return;
        }
        if (id !== state.orgId) await switchTo(id);
        const snap = await Tick.api.readAccount(api, id, org, state.spendCache);
        if (id !== state.orgId) return; // account switched mid-flight
        state.failures = 0;
        state.backoffUntil = 0;
        state.snap = snap;
        meter.setSnapshot(snap);
        meter.setStatus({ state: 'ok' });
        scheduleResetRefresh(snap);
        send({ type: 'snapshot', snapshot: snap });
      } catch (e) {
        onError(e);
      }
    })().finally(() => {
      state.inflight = null;
      meter.setRefreshing(false);
      if (state.queued) {
        state.queued = false;
        setTimeout(() => refresh({ force: true }), 250);
      }
    });
    return state.inflight;
  }

  function onError(e) {
    const s = e && e.status;
    state.failures++;
    let message;
    let short = 'Usage unavailable';
    let wait;
    if (s === 401 || s === 403) {
      message = 'claude.ai declined the usage request. You may be signed out, or this account can’t view usage.';
      wait = 5 * 60e3;
      state.orgsAt = 0;
    } else if (s === 429) {
      message = 'claude.ai is rate limiting usage checks, so the meter is pausing for a few minutes.';
      short = 'Usage paused';
      wait = 5 * 60e3;
    } else if (s === 404) {
      message = 'This account doesn’t expose usage data.';
      short = 'No usage data';
      wait = 30 * 60e3;
    } else {
      message = `Couldn’t reach claude.ai (${s || (e && e.detail) || 'network error'}).`;
      wait = Math.min(10 * 60e3, 30e3 * Math.pow(2, Math.min(5, state.failures - 1)));
    }
    state.backoffUntil = Date.now() + wait;
    meter.setStatus({ state: 'error', message, short });
    if (e && e.detail === 'invalid org id') state.orgId = null;
  }

  // Refresh just after the soonest reset so a maxed meter clears on its own.
  function scheduleResetRefresh(snap) {
    clearTimeout(state.resetTimer);
    const now = Date.now();
    const times = snap.limits.map((l) => l.resetsAt).filter((t) => t && t > now);
    if (snap.spend && snap.spend.resetsAt > now && !snap.spend.resetsApprox) times.push(snap.spend.resetsAt);
    if (!times.length) return;
    const wait = Math.min(...times) - now + 4000;
    if (wait < 2 ** 31 - 1) state.resetTimer = setTimeout(() => refresh({ force: true }), wait);
  }

  /* ---------- activity detection ---------- */

  // Sends: legacy /completion and the merged experience's protobuf RPC. Ends: the completion
  // stream closing, the timeline stream closing, or the conversation tree reload claude.ai does
  // after a reply settles. Resource timing entries arrive when a response finishes, which for a
  // streamed reply means when generation is done.
  const SEND = /\/(?:retry_)?completion(?:\?|$)|ConversationService\/PerformAction(?:\?|$)/;
  const SETTLED = /\/(?:retry_)?completion(?:\?|$)|ConversationService\/StreamTimeline(?:\?|$)|\/chat_conversations\/[^/?]+\?[^#]*tree=/i;

  let lastSettledRefresh = 0;
  function onActivity(kind) {
    if (kind === 'settled') {
      if (Date.now() - lastSettledRefresh < 4000) return;
      lastSettledRefresh = Date.now();
      setTimeout(() => refresh({ force: true }), 1200);
    }
    // Usage keeps moving while a long reply or tool run is in flight; check in a few times.
    state.burst.forEach(clearTimeout);
    state.burst = [6e3, 20e3, 50e3, 110e3].map((ms) => setTimeout(() => refresh({ force: true }), ms));
  }

  let po = null;
  try {
    po = new PerformanceObserver((list) => {
      let kind = null;
      for (const e of list.getEntries()) {
        const url = e.name || '';
        if (url.indexOf('/api/') === -1 && url.indexOf('claudeai-rpc') === -1) continue;
        if (SETTLED.test(url)) kind = 'settled';
        else if (!kind && SEND.test(url)) kind = 'send';
      }
      if (kind) onActivity(kind);
    });
    po.observe({ type: 'resource', buffered: false });
  } catch (_) {
    po = null; // older engines: polling still covers it
  }

  /* ---------- mounting & lifecycle ---------- */

  let checkQueued = false;
  function scheduleCheck() {
    if (checkQueued || dead) return;
    checkQueued = true;
    setTimeout(() => {
      checkQueued = false;
      if (!dead) meter.ensureMounted();
    }, 200);
  }

  const mo = new MutationObserver(scheduleCheck);
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Theme switches flip a class or attribute on <html>/<body>; the OS setting can flip it too.
  const themeMo = new MutationObserver(() => meter.anchor && meter.syncTheme());
  themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] });
  if (document.body) themeMo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] });
  try {
    root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(() => meter.anchor && meter.syncTheme(), 50));
  } catch (_) {}

  state.timers.push(
    setInterval(() => {
      if (!alive()) return shutdown();
      meter.ensureMounted();
      // Org switcher: claude.ai rewrites the lastActiveOrg cookie.
      const c = cookieOrg();
      if (c && state.orgId && c !== state.orgId) refresh({ force: true });
    }, 2000),
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const age = Date.now() - ((state.snap && state.snap.fetchedAt) || 0);
      if (age >= POLL_MS - 2000) refresh();
    }, 15e3)
  );

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    const age = Date.now() - ((state.snap && state.snap.fetchedAt) || 0);
    if (age > 20e3) refresh();
    meter.anchor && meter.syncTheme();
  };
  document.addEventListener('visibilitychange', onVisible);
  root.addEventListener('focus', onVisible);

  /* ---------- extension plumbing ---------- */

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'refresh') {
      Promise.resolve(refresh({ force: true })).then(() => reply({ ok: true, snapshot: state.snap }));
      return true;
    }
    if (msg.type === 'ping') {
      reply({ ok: true, orgId: state.orgId });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      state.settings = { ...Tick.DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
      meter.setSettings(state.settings);
    }
  });

  (async function start() {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      state.settings = { ...Tick.DEFAULT_SETTINGS, ...(settings || {}) };
    } catch (_) {}
    // A previous copy of this script (extension reloaded or updated) may have left a meter behind.
    document.querySelectorAll('[data-tick]').forEach((n) => n !== meter.host && n.remove());
    meter.setSettings(state.settings);
    const c = cookieOrg();
    if (c) await switchTo(c);
    meter.ensureMounted();
    refresh({ force: true });
  })();
})(typeof globalThis !== 'undefined' ? globalThis : self);
