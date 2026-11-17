/*
 * DOM helpers and the "details" view shared by the in-page panel and the toolbar popup.
 * Everything is built with DOM APIs (no innerHTML), so org names and model labels coming back
 * from the API can never inject markup.
 */
(function (root) {
  'use strict';
  const Tick = (root.Tick = root.Tick || {});
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) node.style.setProperty(sk, sv);
        } else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  const ICONS = {
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    chevron: 'M6 15l6-6 6 6',
    close: 'M6 6l12 12M18 6L6 18'
  };

  function icon(name, size = 14) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICONS[name] || '');
    svg.append(p);
    return svg;
  }

  Tick.el = el;
  Tick.icon = icon;

  /* ---------- details view ---------- */

  Tick.DETAILS_CSS = `
.d { display:flex; flex-direction:column; gap:14px; font-size:13px; line-height:1.35; color:var(--fg); }
.d-head { display:flex; align-items:center; gap:8px; min-width:0; }
.d-plan { flex:none; font-size:11px; font-weight:600; letter-spacing:.02em; padding:2px 7px; border-radius:999px;
  color:var(--accent-ink); background:var(--accent-soft); }
.d-acct { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.d-ago { flex:none; font-size:11.5px; color:var(--fg-faint); font-variant-numeric:tabular-nums; }
.d-icon { all:unset; flex:none; display:inline-grid; place-items:center; width:26px; height:26px; border-radius:8px;
  color:var(--fg-muted); cursor:pointer; transition:background .15s,color .15s; }
.d-icon:hover { background:var(--hover); color:var(--fg); }
.d-icon:focus-visible { outline:2px solid var(--ring); outline-offset:1px; }
.d-icon.spin svg { animation:um-spin .8s linear infinite; }
@keyframes um-spin { to { transform:rotate(360deg); } }
.d-banner { font-size:12px; padding:8px 10px; border-radius:10px; background:var(--hover); color:var(--fg-muted); }
.d-banner.err { color:var(--crit); background:color-mix(in srgb, var(--crit) 10%, transparent); }
.d-rows { display:flex; flex-direction:column; gap:14px; }
.d-row { display:flex; flex-direction:column; gap:6px; }
.d-top { display:flex; align-items:baseline; justify-content:space-between; gap:12px; }
.d-label { font-weight:500; color:var(--fg); }
.d-val { font-weight:600; font-variant-numeric:tabular-nums; white-space:nowrap; }
.d-val small { font-weight:500; color:var(--fg-faint); font-size:11.5px; margin-left:2px; }
.d-row[data-sev="crit"] .d-val, .d-row[data-sev="max"] .d-val { color:var(--crit); }
.d-row[data-sev="warn"] .d-val { color:var(--warn-ink); }
.d-track { position:relative; height:7px; border-radius:999px; background:var(--track); }
.d-fill { position:absolute; left:0; top:0; bottom:0; border-radius:inherit; background:var(--fill, var(--ok));
  background-image:linear-gradient(90deg, color-mix(in srgb, var(--fill, var(--ok)) 70%, transparent), var(--fill, var(--ok)));
  transition:width .7s cubic-bezier(.22,1,.36,1); }
.d-row[data-sev="warn"] { --fill:var(--warn); }
.d-row[data-sev="crit"], .d-row[data-sev="max"] { --fill:var(--crit); }
.d-tick { position:absolute; top:-3px; bottom:-3px; width:2px; margin-left:-1px; border-radius:1px; background:var(--tick); }
.d-meta { display:flex; justify-content:space-between; gap:10px; font-size:11.5px; color:var(--fg-faint); font-variant-numeric:tabular-nums; }
.d-note { font-size:12px; color:var(--fg-muted); }
.d-note.bad { color:var(--crit); }
.d-note.warn { color:var(--warn-ink); }
.d-note.good { color:var(--fg-muted); }
.d-empty { color:var(--fg-muted); font-size:12.5px; }
.d-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:10px; border-top:1px solid var(--border); }
.d-link { all:unset; display:inline-flex; align-items:center; gap:5px; font-size:12px; color:var(--fg-muted); cursor:pointer; border-radius:6px; padding:2px 4px; margin:-2px -4px; }
.d-link:hover { color:var(--fg); background:var(--hover); }
.d-link:focus-visible { outline:2px solid var(--ring); }
.d-legend { font-size:11px; color:var(--fg-faint); display:flex; align-items:center; gap:6px; }
.d-legend i { display:inline-block; width:2px; height:9px; border-radius:1px; background:var(--tick); }
`;

  function bigTrack(pct, pace, showPace) {
    return el(
      'div',
      { class: 'd-track', role: 'presentation' },
      el('div', { class: 'd-fill', style: { width: (pct == null ? 0 : Math.min(100, pct)) + '%' } }),
      showPace && pace ? el('div', { class: 'd-tick', style: { left: pace.expected.toFixed(2) + '%' }, title: 'Even pace' }) : null
    );
  }

  function limitNote(l, pace, now) {
    if (l.pct >= 100) return { text: l.resetsAt ? `Limit reached. Back in ${Tick.fmtDuration(l.resetsAt - now)}.` : 'Limit reached.', tone: 'bad' };
    if (l.id === 'session' && !l.resetsAt) return { text: 'No active window. It starts with your next message.', tone: 'good' };
    if (!pace) return null;
    if (pace.hitAt) {
      return { text: `At this pace you’d hit it around ${Tick.fmtDayClock(pace.hitAt, now)}.`, tone: l.pct >= 75 ? 'bad' : 'warn' };
    }
    if (pace.projected != null) return { text: `On pace for about ${Math.round(pace.projected)}% by reset.`, tone: 'good' };
    return null;
  }

  function limitRow(l, settings, now) {
    const sev = Tick.severity(l.pct);
    const pace = Tick.pace(l, now);
    const note = settings.showPace ? limitNote(l, pace, now) : l.pct >= 100 ? limitNote(l, null, now) : null;
    return el(
      'div',
      { class: 'd-row', 'data-sev': sev, 'data-id': l.id },
      el('div', { class: 'd-top' }, el('span', { class: 'd-label', text: l.label }), el('span', { class: 'd-val', text: Tick.fmtPct(l.pct) + ' used' })),
      bigTrack(l.pct, pace, settings.showPace),
      el('div', { class: 'd-meta' }, el('span', { text: Tick.fmtResetLong(l.resetsAt, now) || (l.id === 'session' ? 'Window not started' : 'Reset time not reported') })),
      note ? el('div', { class: 'd-note ' + note.tone, text: note.text }) : null
    );
  }

  function spendRow(sp, label, settings, now) {
    const sev = Tick.severity(sp.pct);
    const item = { pct: sp.pct, resetsAt: sp.resetsAt, windowMs: sp.windowMs };
    const pace = sp.pct != null ? Tick.pace(item, now) : null;
    const m = (v) => Tick.fmtMoney(v, sp.currency);

    let value;
    if (sp.usedMinor == null) value = sp.limitMinor != null ? el('span', { class: 'd-val' }, m(sp.limitMinor), el('small', { text: 'cap' })) : el('span', { class: 'd-val', text: '—' });
    else if (sp.limitMinor != null) value = el('span', { class: 'd-val' }, m(sp.usedMinor), el('small', { text: 'of ' + m(sp.limitMinor) }));
    else value = el('span', { class: 'd-val' }, m(sp.usedMinor), el('small', { text: 'this month' }));

    let note = null;
    if (sp.usedMinor == null) note = { text: 'Claude didn’t report your spend for this period.', tone: 'good' };
    else if (sp.pct != null && sp.pct >= 100) note = { text: `Spend cap reached. Resets ${Tick.fmtDate(sp.resetsAt)}.`, tone: 'bad' };
    else if (settings.showPace) {
      const elapsed = now - sp.periodStart;
      if (elapsed > 0 && sp.windowMs && elapsed / sp.windowMs >= 0.05 && sp.usedMinor > 0) {
        const projected = (sp.usedMinor / elapsed) * sp.windowMs;
        if (sp.limitMinor != null && projected > sp.limitMinor) {
          const hitAt = sp.periodStart + (sp.limitMinor / sp.usedMinor) * elapsed;
          note = { text: `At this pace you’d reach your cap around ${Tick.fmtDate(hitAt)}.`, tone: 'warn' };
        } else {
          note = { text: `On pace for about ${m(projected)} by ${Tick.fmtDate(sp.resetsAt)}.`, tone: 'good' };
        }
      }
      if (!note && sp.limitMinor == null) note = { text: 'No spend cap is set for your account.', tone: 'good' };
    }

    return el(
      'div',
      { class: 'd-row', 'data-sev': sev, 'data-id': 'spend' },
      el('div', { class: 'd-top' }, el('span', { class: 'd-label', text: label }), value),
      sp.limitMinor != null && sp.usedMinor != null ? bigTrack(sp.pct, pace, settings.showPace) : null,
      el('div', { class: 'd-meta' }, el('span', { text: Tick.fmtResetLong(sp.resetsAt, now, sp.resetsApprox) })),
      note ? el('div', { class: 'd-note ' + note.tone, text: note.text }) : null
    );
  }

  /**
   * @param snap     snapshot from Tick.buildSnapshot (or null while loading)
   * @param opts     { settings, now, status: {state, message}, onRefresh, onSettings, refreshing }
   */
  Tick.renderDetails = function (snap, opts = {}) {
    const settings = { ...Tick.DEFAULT_SETTINGS, ...(opts.settings || {}) };
    const now = opts.now || Date.now();
    const status = opts.status || {};

    const refreshBtn = opts.onRefresh
      ? el('button', { class: 'd-icon' + (opts.refreshing ? ' spin' : ''), title: 'Refresh now', 'aria-label': 'Refresh usage now', onclick: opts.onRefresh }, icon('refresh', 15))
      : null;

    const head = el(
      'div',
      { class: 'd-head' },
      snap && snap.plan ? el('span', { class: 'd-plan', text: snap.plan.label }) : null,
      el('span', { class: 'd-acct', text: snap ? Tick.accountLabel(snap) : 'Claude usage', title: snap && snap.orgName ? snap.orgName : null }),
      snap ? el('span', { class: 'd-ago', text: Tick.fmtAgo(snap.fetchedAt, now) }) : null,
      refreshBtn
    );

    const parts = [head];

    if (status.state === 'error' && status.message) {
      parts.push(el('div', { class: 'd-banner err', text: status.message }));
    } else if (status.state === 'info' && status.message) {
      parts.push(el('div', { class: 'd-banner', text: status.message }));
    }

    const rows = el('div', { class: 'd-rows' });
    if (!snap) {
      rows.append(el('div', { class: 'd-empty', text: status.state === 'loading' || !status.state ? 'Loading usage…' : 'No usage data yet. Open claude.ai to load it.' }));
    } else if (snap.mode === 'rate') {
      snap.limits.forEach((l) => rows.append(limitRow(l, settings, now)));
      if (snap.spend) rows.append(spendRow(snap.spend, 'Usage credits', settings, now));
    } else if (snap.mode === 'spend') {
      if (snap.spend) rows.append(spendRow(snap.spend, 'Monthly spend', settings, now));
      else rows.append(el('div', { class: 'd-empty', text: 'This account is billed by usage, but Claude didn’t report your spend. Your admin may have individual usage reporting turned off.' }));
    } else if (snap.mode === 'free') {
      rows.append(el('div', { class: 'd-empty', text: 'Claude doesn’t report usage limits for Free accounts, so there’s nothing reliable to show here.' }));
    } else {
      rows.append(el('div', { class: 'd-empty', text: 'Claude didn’t return any usage limits for this account.' }));
    }
    parts.push(rows);

    if (snap && settings.showPace && (snap.mode === 'rate' || (snap.spend && snap.spend.pct != null))) {
      parts.push(el('div', { class: 'd-legend' }, el('i'), 'Even pace. Projections are straight-line estimates.'));
    }

    const foot = el(
      'div',
      { class: 'd-foot' },
      el('a', { class: 'd-link', href: 'https://claude.ai/settings/usage', target: '_blank', rel: 'noopener' }, 'Claude usage settings', icon('external', 12)),
      opts.onSettings ? el('button', { class: 'd-link', onclick: opts.onSettings }, icon('gear', 13), 'Options') : null
    );
    parts.push(foot);

    return el('div', { class: 'd' }, parts);
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
