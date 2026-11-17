/*
 * Toolbar popup, also used as the options page. Shows every account the extension has seen
 * (personal and organizations), with settings underneath.
 */
(function () {
  'use strict';
  const Tick = window.Tick;
  const $ = (id) => document.getElementById(id);
  document.head.append(Tick.el('style', { text: Tick.DETAILS_CSS }));

  const S = {
    settings: { ...Tick.DEFAULT_SETTINGS },
    snaps: {},
    current: null,
    refreshing: false,
    status: {}
  };

  /* ---------- data ---------- */

  async function loadLocal() {
    const all = await chrome.storage.local.get(null);
    S.snaps = {};
    for (const [k, v] of Object.entries(all)) if (k.startsWith('snap:') && v && v.v === 1) S.snaps[k.slice(5)] = v;
    if (!S.current || !S.snaps[S.current]) {
      S.current = all.lastOrg && S.snaps[all.lastOrg] ? all.lastOrg : Object.keys(S.snaps)[0] || null;
    }
    return all;
  }

  function describe(e) {
    const s = e && e.status;
    if (s === 401 || s === 403) return 'Sign in to claude.ai in this browser, then refresh.';
    if (s === 429) return 'claude.ai is rate limiting requests. Try again in a few minutes.';
    if (e && e.detail === 'not JSON') return 'claude.ai asked for a browser check. Open claude.ai once, then refresh.';
    if (s === 0 || s == null) return (e && e.message && !e.status ? e.message : 'Couldn’t reach claude.ai.');
    return `claude.ai returned an error (${s}).`;
  }

  // Prefer an open claude.ai tab: it already knows which account is active.
  async function refreshViaTab(target) {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' }).catch(() => []);
    for (const t of tabs) {
      try {
        const r = await chrome.tabs.sendMessage(t.id, { type: 'refresh' });
        if (r && r.snapshot && (!target || r.snapshot.orgId === target)) return r.snapshot;
      } catch (_) {}
    }
    return null;
  }

  // No usable tab: read straight from claude.ai with the browser's existing session.
  // With no account known yet, discover them (personal + any organizations) first.
  async function refreshDirect(target) {
    const api = Tick.api.client('https://claude.ai');
    let orgs = [];
    try {
      const list = await api.organizations();
      orgs = Array.isArray(list) ? list : [];
    } catch (e) {
      if (!target) throw e;
    }
    const chatOrgs = orgs.filter((o) => Tick.api.isOrgId(o.uuid) && (!Array.isArray(o.capabilities) || o.capabilities.includes('chat')));
    const ids = target ? [target] : chatOrgs.slice(0, 5).map((o) => o.uuid);
    if (!ids.length) {
      const err = new Error('No claude.ai accounts found. Sign in at claude.ai, then refresh.');
      err.status = 0;
      throw err;
    }
    let first = null;
    let lastErr = null;
    for (const id of ids) {
      const org = orgs.find((o) => o.uuid === id) || null;
      try {
        const snap = await Tick.api.readAccount(api, id, org, {});
        // The account being viewed (or, on first run, the first one found) drives the badge.
        await chrome.runtime.sendMessage({ type: 'snapshot', snapshot: snap, passive: target ? false : !!first });
        first = first || snap;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!first) throw lastErr;
    return first;
  }

  async function refresh() {
    if (S.refreshing) return;
    S.refreshing = true;
    S.status = {};
    renderDetails();
    try {
      const target = S.current;
      const snap = (await refreshViaTab(target)) || (await refreshDirect(target));
      if (!S.current && snap) S.current = snap.orgId;
    } catch (e) {
      S.status = { state: 'error', message: describe(e) };
    }
    await loadLocal();
    S.refreshing = false;
    render();
  }

  /* ---------- render ---------- */

  function renderAccounts() {
    const nav = $('accounts');
    const ids = Object.keys(S.snaps);
    if (ids.length < 2) {
      nav.hidden = true;
      nav.replaceChildren();
      return;
    }
    ids.sort((a, b) => S.snaps[a].isOrg - S.snaps[b].isOrg || Tick.accountLabel(S.snaps[a]).localeCompare(Tick.accountLabel(S.snaps[b])));
    nav.hidden = false;
    nav.replaceChildren(
      ...ids.map((id) => {
        const s = S.snaps[id];
        return Tick.el(
          'button',
          {
            class: 'acct',
            type: 'button',
            'aria-pressed': String(id === S.current),
            title: s.orgName || null,
            onclick: () => {
              if (S.current === id) return;
              S.current = id;
              S.status = {};
              render();
              if (Date.now() - s.fetchedAt > 30e3) refresh();
            }
          },
          Tick.el('span', { class: 't', text: Tick.accountLabel(s) }),
          s.plan ? Tick.el('span', { class: 'p', text: s.plan.label }) : null
        );
      })
    );
  }

  function renderDetails() {
    const snap = S.current ? S.snaps[S.current] : null;
    const status = S.status.state ? S.status : snap ? {} : { state: S.refreshing ? 'loading' : 'empty' };
    $('details').replaceChildren(
      Tick.renderDetails(snap, { settings: S.settings, status, refreshing: S.refreshing, onRefresh: () => refresh() })
    );
  }

  function renderSettings() {
    document.querySelectorAll('.switch').forEach((input) => {
      input.checked = !!S.settings[input.dataset.key];
    });
    document.querySelectorAll('.seg').forEach((seg) => {
      const v = String(S.settings[seg.dataset.key]);
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
    });
  }

  function render() {
    renderAccounts();
    renderDetails();
    renderSettings();
  }

  async function save(patch) {
    S.settings = { ...S.settings, ...patch };
    renderSettings();
    renderDetails();
    await chrome.storage.sync.set({ settings: S.settings });
  }

  /* ---------- wire up ---------- */

  document.querySelectorAll('.switch').forEach((input) => {
    input.addEventListener('change', () => save({ [input.dataset.key]: input.checked }));
  });
  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = seg.dataset.key;
      const v = typeof Tick.DEFAULT_SETTINGS[key] === 'number' ? Number(b.dataset.v) : b.dataset.v;
      save({ [key]: v });
    });
    // Arrow keys move between options, like a native radio group.
    seg.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const btns = [...seg.querySelectorAll('button')];
      const i = btns.indexOf(document.activeElement);
      const next = btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length];
      next.focus();
      next.click();
      e.preventDefault();
    });
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('snap:'))) {
      await loadLocal();
      if (!S.refreshing) render();
    }
    if (area === 'sync' && changes.settings) {
      S.settings = { ...Tick.DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
      renderSettings();
      renderDetails();
    }
  });

  (async function init() {
    const manifest = chrome.runtime.getManifest();
    $('name').textContent = manifest.name;
    $('ver').textContent = 'v' + manifest.version;
    document.title = manifest.name;

    chrome.tabs.getCurrent((tab) => {
      if (tab) document.body.classList.add('tab'); // opened as the options page
    });

    const all = await loadLocal();
    const theme = all.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      S.settings = { ...Tick.DEFAULT_SETTINGS, ...(settings || {}) };
    } catch (_) {}
    render();

    const snap = S.current && S.snaps[S.current];
    if (!snap || Date.now() - snap.fetchedAt > 30e3) refresh();
    setInterval(renderDetails, 30e3);
  })();
})();
