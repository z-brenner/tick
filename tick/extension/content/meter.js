/*
 * The meter that sits directly under claude.ai's chat box.
 *
 * Lives in a shadow root so claude.ai's styles can't reach in and ours can't leak out. Colors
 * are sampled from the composer itself, so it follows whatever theme Claude is showing (light,
 * dark, or a future palette) without hard-coding Claude's CSS variables.
 */
(function (root) {
  'use strict';
  const Tick = root.Tick;
  const { el, icon } = Tick;

  const REDUCED = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CSS = `
:host { display:block; position:relative; box-sizing:border-box; width:100%; margin:6px 0 2px; padding:0;
  line-height:1.2; -webkit-font-smoothing:antialiased; color:var(--fg);
  --ok:#c6613f; --warn:#d99a1e; --warn-ink:#9a6200; --crit:#d6453d;
  --accent-ink:#9a4529; --accent-soft:color-mix(in srgb, var(--ok) 13%, transparent);
  --ring:color-mix(in srgb, var(--ok) 55%, transparent); }
:host([data-theme="dark"]) { --ok:#e0896a; --warn:#f1b84a; --warn-ink:#f3c56b; --crit:#ff7a72; --accent-ink:#f2b59d; }
:host([hidden]) { display:none; }
*, *::before, *::after { box-sizing:border-box; }

.bar { display:flex; align-items:center; gap:16px; min-height:28px; padding:2px 10px; font-size:12px; overflow:hidden;
  color:var(--fg-muted); animation:um-in .45s cubic-bezier(.22,1,.36,1) both; }
@keyframes um-in { from { opacity:0; transform:translateY(-3px); } }

.item { all:unset; flex:none; display:inline-flex; align-items:center; gap:8px; padding:4px 7px; margin:-4px -7px;
  border-radius:8px; cursor:pointer; transition:background-color .15s; }
.item:hover { background:var(--hover); }
.item:focus-visible { outline:2px solid var(--ring); outline-offset:1px; }
.label { font-weight:500; color:var(--fg-muted); white-space:nowrap; }
.label .s { display:none; }
.track { position:relative; flex:none; width:76px; height:5px; border-radius:999px; background:var(--track); }
.item.chip .track { width:46px; }
.fill { position:absolute; left:0; top:0; bottom:0; width:0; border-radius:inherit; background:var(--fill, var(--ok));
  background-image:linear-gradient(90deg, color-mix(in srgb, var(--fill, var(--ok)) 68%, transparent), var(--fill, var(--ok)));
  transition:width .8s cubic-bezier(.22,1,.36,1), background-color .3s; }
.tick { position:absolute; top:-3px; bottom:-3px; width:2px; margin-left:-1px; border-radius:1px; background:var(--tick);
  transition:left .8s cubic-bezier(.22,1,.36,1); }
.val { font-weight:600; color:var(--fg); font-variant-numeric:tabular-nums; white-space:nowrap; }
.meta { color:var(--fg-faint); font-variant-numeric:tabular-nums; white-space:nowrap; }
.item[data-sev="warn"] { --fill:var(--warn); }
.item[data-sev="crit"], .item[data-sev="max"] { --fill:var(--crit); }
.item[data-sev="crit"] .val, .item[data-sev="max"] .val { color:var(--crit); }
.item[data-sev="max"] .fill { animation:um-pulse 2.6s ease-in-out infinite; }
@keyframes um-pulse { 50% { opacity:.55; } }
.sep { flex:none; width:1px; height:12px; background:var(--sep); }
.grow { flex:1 1 0; min-width:0; }
.note { min-width:0; color:var(--fg-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.skel { flex:none; width:76px; height:5px; border-radius:999px;
  background:linear-gradient(90deg, var(--track) 0%, var(--hover2) 50%, var(--track) 100%); background-size:200% 100%;
  animation:um-shimmer 1.3s linear infinite; }
@keyframes um-shimmer { to { background-position:-200% 0; } }
.acct { flex:none; display:inline-flex; align-items:center; gap:6px; max-width:240px; color:var(--fg-faint); white-space:nowrap; }
.acct .nm { overflow:hidden; text-overflow:ellipsis; }
.acct .pl { flex:none; font-size:10.5px; font-weight:600; letter-spacing:.02em; padding:1px 7px; border-radius:999px;
  color:var(--accent-ink); background:var(--accent-soft); }
:host(:not([data-size="l"])) .acct { display:none; }
.dot { flex:none; width:6px; height:6px; border-radius:50%; background:var(--warn); }
.dot[data-state="error"] { background:var(--crit); }
.more { all:unset; flex:none; display:inline-grid; place-items:center; width:22px; height:22px; border-radius:7px;
  color:var(--fg-faint); cursor:pointer; transition:background-color .15s, color .15s; }
.more:hover { background:var(--hover); color:var(--fg); }
.more:focus-visible { outline:2px solid var(--ring); }
.more svg { transition:transform .22s cubic-bezier(.22,1,.36,1); }
.more[aria-expanded="true"] svg { transform:rotate(180deg); }

:host([data-size="l"]) .meta .m, :host([data-size="l2"]) .meta .m, :host([data-size="m"]) .meta .l { display:none; }
:host([data-size="m"]) .chip .meta, :host([data-size="s"]) .meta, :host([data-size="xs"]) .meta { display:none; }
:host([data-size="s"]) .track { width:60px; }
/* When a limit is maxed, "back in 1h 12m" is the most useful thing on the row: keep it. */
:host([data-size="s"]) .item[data-sev="max"] .meta { display:inline; }
:host([data-size="s"]) .item[data-sev="max"] .meta .l { display:none; }
:host([data-size="s"]) .chip .track, :host([data-size="xs"]) .track { width:40px; }
:host([data-size="xs"]) .bar { gap:12px; }
:host([data-size="xs"]) .sep { display:none; }
:host([data-size="xs"]) .label .f { display:none; }
:host([data-size="xs"]) .label .s { display:inline; }

.panel { position:fixed; z-index:2147483646; width:352px; max-width:calc(100vw - 24px); max-height:calc(100vh - 32px);
  overflow:auto; padding:14px 14px 12px; border-radius:16px; background:var(--panel-bg); color:var(--fg);
  border:1px solid var(--border); font-size:13px;
  box-shadow:0 1px 2px rgba(0,0,0,.06), 0 14px 36px -10px rgba(0,0,0,.30);
  animation:um-pop .18s cubic-bezier(.22,1,.36,1); }
.panel[hidden] { display:none; }
.panel.below { animation-name:um-pop-down; }
@keyframes um-pop { from { opacity:0; transform:translateY(5px) scale(.985); } }
@keyframes um-pop-down { from { opacity:0; transform:translateY(-5px) scale(.985); } }

.tip { position:fixed; z-index:2147483647; pointer-events:none; max-width:300px; padding:7px 10px; border-radius:9px;
  font-size:12px; line-height:1.4; background:var(--tip-bg); color:var(--tip-fg);
  box-shadow:0 8px 22px -8px rgba(0,0,0,.4); opacity:0; transform:translateY(3px); transition:opacity .12s, transform .12s; }
.tip.on { opacity:1; transform:none; }
.tip b { font-weight:600; }
.tip div + div { margin-top:2px; opacity:.85; }

@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation:none !important; transition:none !important; } }
`;

  /* ---------- color utilities ---------- */

  function parseColor(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
    if (!m) return null;
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  function opaqueBg(node) {
    for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.6) return c;
    }
    const b = parseColor(getComputedStyle(document.documentElement).backgroundColor);
    return b && b.a > 0.6 ? b : null;
  }
  function luminance({ r, g, b }) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  const rgba = (c, a) => `rgba(${c.r},${c.g},${c.b},${a})`;

  /* ---------- composer discovery ---------- */

  const INPUT_SELECTOR = [
    '[data-testid="chat-input"]',
    '[data-testid="code-prompt-input"]',
    'div.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]'
  ].join(',');

  function roundedAncestor(node) {
    for (let n = node.parentElement, i = 0; n && i < 10; n = n.parentElement, i++) {
      const cs = getComputedStyle(n);
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      const bg = parseColor(cs.backgroundColor);
      const bordered = (parseFloat(cs.borderTopWidth) || 0) > 0 || cs.boxShadow !== 'none';
      if (radius >= 10 && ((bg && bg.a > 0.5) || bordered) && n.getBoundingClientRect().width >= 260) return n;
    }
    return null;
  }

  const isRowFlex = (n) => {
    const cs = getComputedStyle(n);
    return cs.display.includes('flex') && !cs.flexDirection.startsWith('column');
  };

  // Climb from the visible box to the smallest wrapper that also holds the composer's own footer
  // row (model picker, disclaimer), so the meter lands below all of it, not wedged inside.
  function composerGroup(box) {
    const br = box.getBoundingClientRect();
    let g = box;
    for (let i = 0; i < 5; i++) {
      const p = g.parentElement;
      if (!p || p === document.body || p.tagName === 'MAIN') break;
      const pr = p.getBoundingClientRect();
      if (pr.width - br.width > 64 || pr.height - br.height > 120) break;
      if (isRowFlex(p)) break;
      // Stay inside the sticky/fixed dock that keeps the composer on screen while scrolling.
      const pos = getComputedStyle(p).position;
      if (pos === 'sticky' || pos === 'fixed') break;
      g = p;
    }
    return g;
  }

  function findAnchor() {
    const inputs = document.querySelectorAll(INPUT_SELECTOR);
    let input = null;
    for (const n of inputs) {
      if (n.closest('[data-tick]')) continue;
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        input = n;
        break;
      }
    }
    if (!input) return null;
    const box = input.closest('.bg-surface-3') || input.closest('fieldset') || roundedAncestor(input) || input.parentElement;
    if (!box) return null;
    return { input, box, group: composerGroup(box) };
  }

  /* ---------- the meter ---------- */

  class Meter {
    constructor({ onRefresh, onOptions } = {}) {
      this.cb = { onRefresh, onOptions };
      this.snap = null;
      this.status = { state: 'loading' };
      this.settings = { ...Tick.DEFAULT_SETTINGS };
      this.model = null;
      this.refreshing = false;
      this.anchor = null;
      this.sig = '';
      this.nodes = new Map();
      this.size = 'l';
      this.tipFor = null;

      this.host = document.createElement('div');
      this.host.setAttribute('data-tick', '');
      this.host.setAttribute('data-theme', 'light');
      this.host.setAttribute('data-size', 'l');
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.bar = el('div', { class: 'bar', role: 'group', 'aria-label': 'Claude usage' });
      this.panel = el('div', { class: 'panel', hidden: true, role: 'dialog', 'aria-label': 'Claude usage details' });
      this.tip = el('div', { class: 'tip', role: 'tooltip', 'aria-hidden': 'true' });
      this.shadow.append(el('style', { text: CSS + Tick.DETAILS_CSS }), this.bar, this.panel, this.tip);

      this.ro = new ResizeObserver(() => this.onResize());
      this.ro.observe(this.host);

      this.onDocPointer = (e) => {
        if (this.panel.hidden) return;
        if (!e.composedPath().includes(this.host)) this.closePanel();
      };
      this.onKey = (e) => {
        if (e.key === 'Escape' && !this.panel.hidden) {
          this.closePanel();
          this.moreBtn && this.moreBtn.focus();
        }
      };
      this.onViewport = () => {
        if (!this.panel.hidden) this.positionPanel();
        this.hideTip();
      };
      document.addEventListener('pointerdown', this.onDocPointer, true);
      document.addEventListener('keydown', this.onKey, true);
      root.addEventListener('resize', this.onViewport);
      root.addEventListener('scroll', this.onViewport, true);

      this.tickTimer = setInterval(() => this.render(), 30e3);
    }

    destroy() {
      clearInterval(this.tickTimer);
      this.ro.disconnect();
      this.boxRO && this.boxRO.disconnect();
      document.removeEventListener('pointerdown', this.onDocPointer, true);
      document.removeEventListener('keydown', this.onKey, true);
      root.removeEventListener('resize', this.onViewport);
      root.removeEventListener('scroll', this.onViewport, true);
      this.host.remove();
    }

    /* ----- state in ----- */

    setSnapshot(snap) {
      this.snap = snap;
      this.render();
    }
    setStatus(status) {
      this.status = status || {};
      this.render();
    }
    setSettings(s) {
      this.settings = { ...Tick.DEFAULT_SETTINGS, ...s };
      this.ensureMounted();
      this.render();
    }
    setRefreshing(on) {
      this.refreshing = on;
      if (!this.panel.hidden) this.renderPanel();
    }

    /* ----- mounting ----- */

    ensureMounted() {
      if (!this.settings.showMeter) {
        if (this.host.isConnected) this.host.remove();
        this.anchor = null;
        return false;
      }
      const a = this.anchor;
      if (a && a.input.isConnected && a.group.isConnected && this.host.isConnected && this.host.previousElementSibling === a.group) {
        this.readModel();
        return true;
      }
      const next = findAnchor();
      if (!next) {
        if (this.host.isConnected) this.host.remove();
        this.anchor = null;
        return false;
      }
      this.anchor = next;
      next.group.after(this.host);
      this.boxRO && this.boxRO.disconnect();
      this.boxRO = new ResizeObserver(() => this.align());
      this.boxRO.observe(next.box);
      this.syncTheme();
      this.align();
      this.readModel();
      this.render();
      return true;
    }

    // Line up exactly under the visible chat box, even if the wrapper we landed in is wider.
    align() {
      const a = this.anchor;
      if (!a || !this.host.isConnected) return;
      const parent = this.host.parentElement;
      if (!parent) return;
      const br = a.box.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      if (pr.width - br.width > 2) {
        this.host.style.maxWidth = br.width + 'px';
        this.host.style.marginLeft = Math.max(0, br.left - pr.left) + 'px';
      } else {
        this.host.style.maxWidth = '';
        this.host.style.marginLeft = '';
      }
    }

    syncTheme() {
      const a = this.anchor;
      const pageBg = opaqueBg(this.host.parentElement || document.body) || { r: 250, g: 249, b: 245, a: 1 };
      const dark = luminance(pageBg) < 0.4;
      const boxBg = a ? opaqueBg(a.box) : null;
      let fg = a ? parseColor(getComputedStyle(a.input).color) : null;
      if (!fg || Math.abs(luminance(fg) - luminance(pageBg)) < 0.25) fg = dark ? { r: 250, g: 249, b: 245 } : { r: 31, g: 30, b: 29 };
      const panelBg = boxBg && Math.abs(luminance(boxBg) - luminance(fg)) > 0.3 ? boxBg : dark ? { r: 48, g: 48, b: 46 } : { r: 255, g: 255, b: 255 };

      const s = this.host.style;
      s.setProperty('--fg', rgba(fg, 1));
      s.setProperty('--fg-muted', rgba(fg, 0.7));
      s.setProperty('--fg-faint', rgba(fg, 0.5));
      s.setProperty('--track', rgba(fg, dark ? 0.14 : 0.1));
      s.setProperty('--hover', rgba(fg, 0.06));
      s.setProperty('--hover2', rgba(fg, 0.2));
      s.setProperty('--sep', rgba(fg, 0.16));
      s.setProperty('--tick', rgba(fg, 0.55));
      s.setProperty('--border', rgba(fg, dark ? 0.14 : 0.11));
      s.setProperty('--panel-bg', rgba(panelBg, 1));
      s.setProperty('--tip-bg', dark ? '#f4f3ee' : '#1f1e1d');
      s.setProperty('--tip-fg', dark ? '#1f1e1d' : '#f4f3ee');
      const theme = dark ? 'dark' : 'light';
      if (this.host.getAttribute('data-theme') !== theme) {
        this.host.setAttribute('data-theme', theme);
        this.onTheme && this.onTheme(theme);
      }
    }

    readModel() {
      const picker = document.querySelector('[data-testid="model-selector-dropdown"]');
      const label = picker ? (picker.getAttribute('aria-label') || picker.textContent || '').trim() : null;
      if (label !== this.model) {
        this.model = label;
        this.render();
      }
    }

    onResize() {
      const w = Math.round(this.host.getBoundingClientRect().width);
      if (!w || w === this.lastWidth) return;
      this.lastWidth = w;
      this.fit();
    }

    // Pick the roomiest layout that fits on one line. Measured, not guessed, so it holds for any
    // number of items, any label length, and any font Claude ships.
    fit() {
      if (!this.host.isConnected) return;
      // l: everything · l2: drop the account tag · m: short reset text · s: no reset text · xs: tight
      const levels = ['l', 'l2', 'm', 's', 'xs'];
      let chosen = 'xs';
      for (const lv of levels) {
        this.host.setAttribute('data-size', lv);
        if (this.bar.scrollWidth <= this.bar.clientWidth + 1) {
          chosen = lv;
          break;
        }
      }
      this.host.setAttribute('data-size', chosen);
      this.size = chosen;
    }

    /* ----- what to show inline ----- */

    inlineItems() {
      const s = this.snap;
      const st = this.status.state;
      if (!s) {
        if (st === 'error') return [{ type: 'note', key: 'n-err', text: this.status.short || 'Usage unavailable' }];
        if (st === 'signedout' || st === 'hidden') return [];
        return [{ type: 'skeleton', key: 'skel' }];
      }
      const out = [];
      if (s.mode === 'rate') {
        const session = s.limits.find((l) => l.id === 'session');
        const weekly = s.limits.find((l) => l.id === 'weekly');
        const main = [session, weekly].filter(Boolean);
        if (!main.length) main.push(...s.limits.slice(0, 2));
        main.forEach((l) => out.push({ type: 'limit', key: l.id, limit: l }));

        // A per-model weekly cap earns a slot when it's the one that will stop you: you're using
        // that model right now, or it's getting close.
        const model = (this.model || '').toLowerCase();
        const scoped = s.limits
          .filter((l) => !main.includes(l))
          .filter((l) => (model && l.scope && model.includes(l.scope.toLowerCase()) && l.pct > 0) || l.pct >= 80)
          .sort((a, b) => b.pct - a.pct)[0];
        if (scoped) out.push({ type: 'limit', key: scoped.id, limit: scoped, chip: true });

        if (s.spend && s.limits.some((l) => l.pct >= 100)) out.push({ type: 'spend', key: 'credits', spend: s.spend, label: 'Credits', chip: true });
      } else if (s.mode === 'spend') {
        if (s.spend) out.push({ type: 'spend', key: 'spend', spend: s.spend, label: 'This month' });
        else out.push({ type: 'note', key: 'n-nospend', text: 'Usage-billed account · spend not reported' });
      } else if (s.mode === 'free') {
        out.push({ type: 'note', key: 'n-free', text: 'Free plan · Claude doesn’t report limits' });
      } else {
        out.push({ type: 'note', key: 'n-none', text: 'No usage limits reported' });
      }
      return out;
    }

    /* ----- render ----- */

    render() {
      if (!this.host.isConnected && this.panel.hidden) return;
      const items = this.inlineItems();
      const sig = items.map((i) => i.key + (i.chip ? '*' : '')).join('|');
      if (sig !== this.sig) this.build(items, sig);
      const now = Date.now();
      for (const it of items) {
        const n = this.nodes.get(it.key);
        if (!n) continue;
        if (it.type === 'limit') this.updateLimit(n, it.limit, now);
        else if (it.type === 'spend') this.updateSpend(n, it.spend, now);
      }
      this.updateDot(now);
      this.updateAccount();
      this.fit();
      if (!this.panel.hidden) this.renderPanel();
      if (this.tipFor) this.showTip(this.tipFor);
    }

    build(items, sig) {
      this.sig = sig;
      this.nodes.clear();
      this.bar.replaceChildren();
      this.hideTip();
      let first = true;
      for (const it of items) {
        if (it.type === 'skeleton') {
          this.bar.append(el('span', { class: 'label', text: 'Usage' }), el('span', { class: 'skel' }));
          continue;
        }
        if (it.type === 'note') {
          this.bar.append(el('span', { class: 'note', text: it.text }));
          continue;
        }
        if (!first && !it.chip) this.bar.append(el('span', { class: 'sep', 'aria-hidden': 'true' }));
        first = false;

        const short = it.type === 'limit' ? it.limit.short : it.label;
        const full = it.type === 'limit' ? (it.chip ? it.limit.short : it.limit.label) : it.label;
        const fill = el('span', { class: 'fill' });
        const tick = el('span', { class: 'tick', hidden: true });
        const track = el('span', { class: 'track', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': full }, fill, tick);
        const val = el('span', { class: 'val' });
        const metaL = el('span', { class: 'l' });
        const metaM = el('span', { class: 'm' });
        const meta = el('span', { class: 'meta' }, metaL, metaM);
        const node = el(
          'button',
          { class: 'item' + (it.chip ? ' chip' : ''), type: 'button', 'data-key': it.key },
          el('span', { class: 'label' }, el('span', { class: 'f', text: full }), el('span', { class: 's', text: short })),
          track,
          val,
          meta
        );
        node.addEventListener('click', () => this.togglePanel());
        node.addEventListener('pointerenter', () => this.showTip(it.key));
        node.addEventListener('pointerleave', () => this.hideTip());
        node.addEventListener('focus', () => this.showTip(it.key));
        node.addEventListener('blur', () => this.hideTip());
        this.nodes.set(it.key, { node, fill, tick, track, val, metaL, metaM, item: it, shown: null });
        this.bar.append(node);
      }
      this.bar.append(el('span', { class: 'grow' }));
      this.acctName = el('span', { class: 'nm' });
      this.acctPlan = el('span', { class: 'pl' });
      this.acct = el('span', { class: 'acct' }, this.acctName, this.acctPlan);
      if (items.some((i) => i.type === 'limit' || i.type === 'spend')) this.bar.append(this.acct);
      this.dot = el('span', { class: 'dot', hidden: true });
      this.bar.append(this.dot);
      this.moreBtn = el('button', { class: 'more', type: 'button', 'aria-label': 'Usage details', 'aria-expanded': String(!this.panel.hidden), 'aria-haspopup': 'dialog' }, icon('chevron', 14));
      this.moreBtn.addEventListener('click', () => this.togglePanel());
      this.bar.append(this.moreBtn);
    }

    setFill(n, pct, pace) {
      const w = pct == null ? 0 : Math.min(100, Math.max(0, pct));
      // First paint animates up from zero.
      if (n.shown == null) requestAnimationFrame(() => requestAnimationFrame(() => (n.fill.style.width = w + '%')));
      else n.fill.style.width = w + '%';
      if (this.settings.showPace && pace) {
        n.tick.hidden = false;
        n.tick.style.left = pace.expected.toFixed(2) + '%';
      } else n.tick.hidden = true;
      n.track.setAttribute('aria-valuenow', String(Math.round(w)));
    }

    tween(n, to, fmt) {
      const from = n.shown;
      n.shown = to;
      if (from == null || REDUCED() || Math.abs(to - from) < 0.5) {
        n.val.textContent = fmt(to);
        return;
      }
      const t0 = performance.now();
      const dur = 650;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        n.val.textContent = fmt(from + (to - from) * e);
        if (k < 1 && n.shown === to) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    updateLimit(n, l, now) {
      const sev = Tick.severity(l.pct);
      n.node.setAttribute('data-sev', sev);
      const pace = Tick.pace(l, now);
      this.setFill(n, l.pct, pace);
      this.tween(n, l.pct, (v) => Math.round(v) + '%');
      let metaL;
      let metaM;
      if (l.pct >= 100 && l.resetsAt) {
        metaL = 'back in ' + Tick.fmtDuration(l.resetsAt - now);
        metaM = Tick.fmtDuration(l.resetsAt - now);
      } else if (l.resetsAt) {
        const short = Tick.fmtResetShort(l.resetsAt, this.settings.resetStyle, now);
        const isRel = this.settings.resetStyle === 'relative' || (this.settings.resetStyle === 'smart' && l.resetsAt - now < Tick.util.DAY);
        metaL = (isRel ? 'resets in ' : 'resets ') + short;
        metaM = short;
      } else {
        metaL = l.id === 'session' ? 'not started' : '';
        metaM = metaL;
      }
      n.metaL.textContent = metaL;
      n.metaM.textContent = metaM;
      n.node.setAttribute('aria-label', `${l.label} limit, ${Math.round(l.pct)}% used${l.resetsAt ? ', resets in ' + Tick.fmtDuration(l.resetsAt - now) : ''}. Show details.`);
    }

    updateSpend(n, sp, now) {
      const sev = Tick.severity(sp.pct);
      n.node.setAttribute('data-sev', sev);
      const hasCap = sp.limitMinor != null && sp.usedMinor != null;
      n.track.style.display = hasCap ? '' : 'none';
      if (hasCap) this.setFill(n, sp.pct, sp.pct != null ? Tick.pace({ pct: sp.pct, resetsAt: sp.resetsAt, windowMs: sp.windowMs }, now) : null);
      const used = sp.usedMinor;
      if (used == null) {
        n.val.textContent = '—';
        n.shown = null;
      } else this.tween(n, used, (v) => Tick.fmtMoney(v, sp.currency));
      const tail = hasCap ? 'of ' + Tick.fmtMoney(sp.limitMinor, sp.currency, { whole: true }) : sp.limitMinor == null ? 'no cap' : '';
      n.metaL.textContent = tail ? `${tail} · resets ${Tick.fmtDate(sp.resetsAt)}` : `resets ${Tick.fmtDate(sp.resetsAt)}`;
      n.metaM.textContent = tail;
      n.node.setAttribute('aria-label', `${n.item.label}: ${used == null ? 'not reported' : Tick.fmtMoney(used, sp.currency)}${hasCap ? ' of ' + Tick.fmtMoney(sp.limitMinor, sp.currency) : ''}. Show details.`);
    }

    // Which account these numbers belong to: plan for personal, org name + plan for orgs.
    updateAccount() {
      if (!this.acct) return;
      const s = this.snap;
      this.acctName.textContent = s && s.isOrg ? s.orgName || 'Organization' : '';
      this.acctName.hidden = !(s && s.isOrg);
      this.acctPlan.textContent = s && s.plan ? s.plan.label : '';
      this.acctPlan.hidden = !(s && s.plan);
      this.acct.title = s ? `${Tick.accountLabel(s)}${s.plan ? ' · ' + s.plan.label : ''}` : '';
    }

    updateDot(now) {
      if (!this.dot) return;
      const st = this.status.state;
      const old = this.snap && now - this.snap.fetchedAt > 10 * 60e3;
      if (st === 'error' && this.snap) {
        this.dot.hidden = false;
        this.dot.setAttribute('data-state', 'error');
        this.dot.title = this.status.message || 'Couldn’t refresh';
      } else if (old) {
        this.dot.hidden = false;
        this.dot.setAttribute('data-state', 'stale');
        this.dot.title = 'Last updated ' + Tick.fmtAgo(this.snap.fetchedAt, now);
      } else this.dot.hidden = true;
    }

    /* ----- tooltip ----- */

    tipLines(key, now) {
      const n = this.nodes.get(key);
      if (!n) return null;
      const it = n.item;
      if (it.type === 'limit') {
        const l = this.snap.limits.find((x) => x.id === it.limit.id) || it.limit;
        const lines = [[`${l.label} limit`, ` · ${Math.round(l.pct)}% used`]];
        if (l.resetsAt) lines.push(Tick.fmtResetLong(l.resetsAt, now));
        else if (l.id === 'session') lines.push('Window starts with your next message');
        const p = this.settings.showPace ? Tick.pace(l, now) : null;
        if (l.pct < 100 && p && p.hitAt) lines.push(`At this pace: limit around ${Tick.fmtDayClock(p.hitAt, now)}`);
        else if (l.pct < 100 && p && p.projected != null) lines.push(`On pace for about ${Math.round(p.projected)}% by reset`);
        return lines;
      }
      const sp = it.spend;
      const lines = [[it.label === 'Credits' ? 'Usage credits' : 'Monthly spend', sp.usedMinor != null ? ' · ' + Tick.fmtMoney(sp.usedMinor, sp.currency) : '']];
      if (sp.limitMinor != null) lines.push(`Cap ${Tick.fmtMoney(sp.limitMinor, sp.currency)} (${Tick.fmtPct(sp.pct)} used)`);
      else lines.push('No spend cap set');
      lines.push(Tick.fmtResetLong(sp.resetsAt, now, sp.resetsApprox));
      return lines;
    }

    showTip(key) {
      if (!this.panel.hidden) return this.hideTip();
      const n = this.nodes.get(key);
      const lines = n && this.snap && this.tipLines(key, Date.now());
      if (!lines) return;
      this.tipFor = key;
      this.tip.replaceChildren(
        ...lines.map((ln) => (Array.isArray(ln) ? el('div', null, el('b', { text: ln[0] }), ln[1]) : el('div', { text: ln })))
      );
      const r = n.node.getBoundingClientRect();
      this.tip.style.left = '0px';
      this.tip.style.top = '0px';
      const tr = this.tip.getBoundingClientRect();
      const left = Math.max(8, Math.min(root.innerWidth - tr.width - 8, r.left));
      const above = r.top - tr.height - 8;
      this.tip.style.left = left + 'px';
      this.tip.style.top = (above > 8 ? above : r.bottom + 8) + 'px';
      this.tip.classList.add('on');
    }

    hideTip() {
      this.tipFor = null;
      this.tip.classList.remove('on');
    }

    /* ----- panel ----- */

    togglePanel() {
      if (this.panel.hidden) this.openPanel();
      else this.closePanel();
    }

    openPanel() {
      this.hideTip();
      this.panel.hidden = false;
      this.renderPanel();
      this.positionPanel();
      this.moreBtn && this.moreBtn.setAttribute('aria-expanded', 'true');
      // Opening is a good moment to make sure the numbers are current.
      if (!this.snap || Date.now() - this.snap.fetchedAt > 20e3) this.cb.onRefresh && this.cb.onRefresh();
    }

    closePanel() {
      this.panel.hidden = true;
      this.moreBtn && this.moreBtn.setAttribute('aria-expanded', 'false');
    }

    renderPanel() {
      const scrollTop = this.panel.scrollTop;
      this.panel.replaceChildren(
        Tick.renderDetails(this.snap, {
          settings: this.settings,
          status: this.panelStatus(),
          refreshing: this.refreshing,
          onRefresh: this.cb.onRefresh,
          onSettings: this.cb.onOptions
        })
      );
      this.panel.scrollTop = scrollTop;
    }

    panelStatus() {
      const st = this.status;
      if (st.state === 'error') return { state: 'error', message: st.message + (this.snap ? ` Showing data from ${Tick.fmtAgo(this.snap.fetchedAt)}.` : '') };
      return st;
    }

    positionPanel() {
      const r = this.bar.getBoundingClientRect();
      const vw = root.innerWidth;
      const vh = root.innerHeight;
      const ps = this.panel.style;
      ps.top = ps.bottom = ps.left = ps.right = '';
      const right = Math.max(12, vw - r.right);
      ps.right = right + 'px';
      const pr = this.panel.getBoundingClientRect();
      if (r.top - pr.height - 10 >= 8) {
        ps.bottom = vh - r.top + 8 + 'px';
        this.panel.classList.remove('below');
      } else {
        ps.top = Math.min(vh - pr.height - 8, r.bottom + 8) + 'px';
        this.panel.classList.add('below');
      }
    }
  }

  Tick.Meter = Meter;
  Tick.findAnchor = findAnchor;
})(typeof globalThis !== 'undefined' ? globalThis : self);
