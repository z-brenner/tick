/*
 * Shared, side-effect-free logic: parsing claude.ai's usage payloads, plan detection,
 * pace math, and formatting. Loaded by the content script, the popup and the service worker.
 *
 * Everything here is written against undocumented endpoints, so every parser assumes fields
 * can be missing, renamed, null, or a different type, and degrades to "not shown" rather than
 * throwing or inventing numbers.
 */
(function (root) {
  'use strict';
  const Tick = (root.Tick = root.Tick || {});

  const MIN = 60e3;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const WINDOW = { session: 5 * HOUR, weekly: 7 * DAY };

  Tick.VERSION = '0.1.0';
  Tick.DEFAULT_SETTINGS = Object.freeze({
    showMeter: true, // meter under the chat box
    showPace: true, // pace marker + projection text
    resetStyle: 'smart', // 'smart' | 'relative' | 'clock'
    warnAt: 90, // notify when a limit crosses this %, 0 = off
    notifyReset: true, // notify when a limit you'd nearly used up resets
    badge: true // % on the toolbar icon
  });

  /* ---------- small helpers ---------- */

  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace('%', '').trim());
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function time(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; // unix seconds or ms
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }

  const clampPct = (p) => Math.max(0, Math.min(100, p));
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const titleCase = (s) =>
    String(s || '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  Tick.util = { num, time, clampPct, slug, titleCase, MIN, HOUR, DAY };

  /* ---------- limits ---------- */

  function sessionLimit(base) {
    return { ...base, id: 'session', label: '5-hour', short: '5h', windowMs: WINDOW.session, primary: true };
  }
  function weeklyLimit(base) {
    return { ...base, id: 'weekly', label: 'Weekly', short: 'Week', windowMs: WINDOW.weekly, primary: true };
  }
  function scopedLimit(base, name) {
    return {
      ...base,
      id: 'weekly:' + slug(name),
      label: name + ' weekly',
      short: name,
      scope: name,
      windowMs: WINDOW.weekly,
      primary: false
    };
  }

  // One entry of the newer `limits` array:
  // { kind: 'session'|'weekly_all'|'weekly_scoped', group, percent, severity, resets_at, scope, is_active }
  function limitFromEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const kind = String(e.kind || '').toLowerCase();
    const group = String(e.group || '').toLowerCase();
    const pct = num(e.percent ?? e.utilization);
    if (pct == null) return null;
    const base = { pct: clampPct(pct), resetsAt: time(e.resets_at) };

    if (kind === 'session' || group === 'session') return sessionLimit(base);
    if (kind === 'weekly_all') return weeklyLimit(base);
    if (kind === 'weekly_scoped' || group === 'weekly') {
      const s = e.scope || {};
      const name =
        (s.model && (s.model.display_name || s.model.id)) ||
        (s.surface && (s.surface.display_name || (typeof s.surface === 'string' ? s.surface : null))) ||
        titleCase(kind.replace(/^weekly_?/, '')) ||
        'Scoped';
      return scopedLimit(base, titleCase(name));
    }
    // An unknown kind: show it, labelled honestly, rather than drop it.
    return { ...base, id: kind || 'limit', label: titleCase(kind) || 'Limit', short: titleCase(kind), windowMs: null, primary: false };
  }

  // Older top-level fields. `limits[]` wins when both describe the same limit.
  const LEGACY_SCOPED = {
    seven_day_opus: 'Opus',
    seven_day_sonnet: 'Sonnet',
    seven_day_fable: 'Fable',
    seven_day_omelette: 'Design' // Claude Design's internal codename
  };

  const ORDER = (a, b) => {
    const rank = (l) => (l.id === 'session' ? 0 : l.id === 'weekly' ? 1 : 2);
    return rank(a) - rank(b) || b.pct - a.pct;
  };

  function normalizeLimits(u) {
    const byId = new Map();
    const add = (l) => {
      if (l && !byId.has(l.id)) byId.set(l.id, l);
    };
    if (Array.isArray(u && u.limits)) u.limits.forEach((e) => add(limitFromEntry(e)));

    const legacy = (key, make) => {
      const o = u && u[key];
      if (!o || typeof o !== 'object') return;
      const pct = num(o.utilization ?? o.percent);
      if (pct == null) return;
      add(make({ pct: clampPct(pct), resetsAt: time(o.resets_at) }));
    };
    legacy('five_hour', sessionLimit);
    legacy('seven_day', weeklyLimit);
    for (const [key, name] of Object.entries(LEGACY_SCOPED)) legacy(key, (b) => scopedLimit(b, name));

    return [...byId.values()].sort(ORDER);
  }

  /* ---------- money ---------- */

  function money(o) {
    if (o == null) return null;
    if (typeof o === 'number' || typeof o === 'string') {
      const n = num(o);
      return n == null ? null : { minor: n, currency: null };
    }
    if (typeof o !== 'object') return null;
    if (o.money) return money(o.money);
    const n = num(o.amount_minor ?? o.amount ?? o.value);
    return n == null ? null : { minor: n, currency: o.currency ? String(o.currency).toUpperCase() : null };
  }

  // Monthly spend attached to /usage. Newer payloads use `spend`, older ones `extra_usage`.
  // Both are in minor units (cents for USD). /usage is per member, so this is the member's own
  // figure, not the organization's.
  function parseSpend(u) {
    const s = u && u.spend;
    if (s && typeof s === 'object' && s.enabled !== false) {
      const used = money(s.used);
      const limit = money(s.limit) || money(s.cap);
      if (s.enabled === true || used || limit) {
        return {
          source: 'spend',
          usedMinor: used ? used.minor : null,
          limitMinor: limit ? limit.minor : null, // null = no cap
          currency: (used && used.currency) || (limit && limit.currency) || (s.currency ? String(s.currency).toUpperCase() : 'USD'),
          resetsAt: time(s.resets_at ?? s.period_end ?? (s.period && s.period.end) ?? (s.cap && s.cap.resets_at))
        };
      }
    }
    const x = u && u.extra_usage;
    if (x && typeof x === 'object' && x.is_enabled === true) {
      return {
        source: 'extra_usage',
        usedMinor: num(x.used_credits) ?? 0,
        limitMinor: num(x.monthly_limit),
        currency: x.currency ? String(x.currency).toUpperCase() : 'USD',
        resetsAt: null
      };
    }
    return null;
  }

  // GET /organizations/{org}/usage/spend → { currency, totals: [{ product_surface, cost_minor_units }] }
  // Returns the calling member's month-to-date spend when the org exposes individual analytics.
  Tick.parseMemberSpend = function (r) {
    if (!r || !Array.isArray(r.totals) || r.totals.length === 0) return null;
    let sum = 0;
    let any = false;
    for (const t of r.totals) {
      const v = num(t && t.cost_minor_units);
      if (v != null) {
        sum += v;
        any = true;
      }
    }
    return any ? { usedMinor: sum, currency: r.currency ? String(r.currency).toUpperCase() : 'USD' } : null;
  };

  // GET /organizations/{org}/overage_spend_limit → { is_enabled, monthly_credit_limit, used_credits, currency }
  // Only trusted for personal orgs: on Team/Enterprise this can be the organization's total.
  Tick.parseOverage = function (r) {
    if (!r || r.is_enabled !== true) return null;
    return {
      source: 'overage',
      usedMinor: num(r.used_credits) ?? 0,
      limitMinor: num(r.monthly_credit_limit),
      currency: r.currency ? String(r.currency).toUpperCase() : 'USD',
      resetsAt: null
    };
  };

  /* ---------- plan / account ---------- */

  Tick.planFromOrg = function (org) {
    if (!org || typeof org !== 'object') return null;
    const caps = Array.isArray(org.capabilities) ? org.capabilities.map(String) : [];
    const tier = String(org.rate_limit_tier || '').toLowerCase();
    const raven = String(org.raven_type || '').toLowerCase();
    const billing = String(org.billing_type || '').toLowerCase();

    if (raven || caps.includes('raven')) {
      if (raven.includes('enterprise') || tier.includes('enterprise')) return { key: 'enterprise', label: 'Enterprise' };
      if (raven.includes('edu')) return { key: 'enterprise', label: 'Education' };
      return { key: 'team', label: 'Team' };
    }
    if (tier.includes('enterprise') || billing.includes('enterprise')) return { key: 'enterprise', label: 'Enterprise' };
    if (caps.includes('claude_ultra') || tier.includes('ultra') || tier.includes('20x')) return { key: 'ultra', label: 'Ultra' };
    if (caps.includes('claude_max')) return { key: 'max', label: 'Max' };
    if (caps.includes('claude_pro')) return { key: 'pro', label: 'Pro' };
    if (caps.includes('chat')) return { key: 'free', label: 'Free' };
    return null;
  };

  Tick.accountLabel = function (snap) {
    if (!snap) return '';
    return snap.isOrg ? snap.orgName || 'Organization' : 'Personal';
  };

  Tick.isOrgAccount = function (org) {
    if (!org) return false;
    const caps = Array.isArray(org.capabilities) ? org.capabilities : [];
    return !!org.raven_type || caps.includes('raven');
  };

  /* ---------- snapshot ---------- */

  function startOfMonth(t) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }
  function startOfNextMonth(t) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  }

  /**
   * Turn raw responses into the one shape every surface renders.
   * mode: 'rate'    plan limits (5-hour / weekly / per-model weekly), optional usage credits
   *       'spend'   consumption billed (usage-based Enterprise): monthly spend vs cap
   *       'free'    Free plan, Claude reports nothing
   *       'unknown' nothing usable came back
   * The mode is decided by what /usage reports, never by plan name, so plan changes
   * (Ultra losing its 5-hour window, for example) just work.
   */
  Tick.buildSnapshot = function ({ orgId, org, usage, memberSpend, overage, now = Date.now() }) {
    const plan = Tick.planFromOrg(org);
    const isOrg = Tick.isOrgAccount(org);
    const limits = normalizeLimits(usage || {});
    let spend = parseSpend(usage || {});

    if (memberSpend && memberSpend.usedMinor != null) {
      spend = spend
        ? { ...spend, usedMinor: spend.usedMinor ?? memberSpend.usedMinor }
        : { source: 'usage_spend', usedMinor: memberSpend.usedMinor, limitMinor: null, currency: memberSpend.currency, resetsAt: null };
    }
    if (!spend && overage && !isOrg) spend = overage;

    if (spend) {
      spend = { ...spend }; // inputs may be cached; never mutate them
      spend.periodStart = startOfMonth(now);
      if (!spend.resetsAt) {
        spend.resetsAt = startOfNextMonth(now);
        spend.resetsApprox = true;
      }
      spend.windowMs = spend.resetsAt - spend.periodStart;
      spend.pct = spend.limitMinor > 0 && spend.usedMinor != null ? clampPct((spend.usedMinor / spend.limitMinor) * 100) : null;
    }

    let mode;
    if (limits.length) mode = 'rate';
    else if (spend) mode = 'spend';
    else if (plan && plan.key === 'enterprise') mode = 'spend';
    else if (plan && plan.key === 'free') mode = 'free';
    else mode = 'unknown';

    return {
      v: 1,
      orgId,
      orgName: (org && org.name) || null,
      plan,
      isOrg,
      mode,
      limits,
      spend,
      fetchedAt: now
    };
  };

  /** The single number that best answers "how close am I?" (badge, notifications). */
  Tick.primaryReading = function (snap) {
    if (!snap) return null;
    if (snap.mode === 'rate') {
      const s = snap.limits.find((l) => l.id === 'session');
      const w = snap.limits.find((l) => l.id === 'weekly');
      // The binding one is whichever is closer to its cap.
      const cands = [s, w].filter(Boolean);
      if (!cands.length && snap.limits.length) cands.push(snap.limits[0]);
      return cands.sort((a, b) => b.pct - a.pct)[0] || null;
    }
    if (snap.mode === 'spend' && snap.spend && snap.spend.pct != null) {
      return { id: 'spend', label: 'Monthly spend', pct: snap.spend.pct, resetsAt: snap.spend.resetsAt };
    }
    return null;
  };

  /* ---------- pace ---------- */

  Tick.severity = function (pct) {
    if (pct == null) return 'ok';
    if (pct >= 100) return 'max';
    if (pct >= 90) return 'crit';
    if (pct >= 75) return 'warn';
    return 'ok';
  };

  /**
   * Where usage "should" be if spread evenly across the window, and a straight-line projection.
   * The projection is an estimate and is labelled as one wherever it is shown.
   */
  Tick.pace = function (item, now = Date.now()) {
    const windowMs = item.windowMs;
    const resetsAt = item.resetsAt;
    const pct = item.pct;
    if (!windowMs || !resetsAt || pct == null) return null;
    const start = resetsAt - windowMs;
    const elapsed = now - start;
    if (elapsed <= 0 || now >= resetsAt) return null;
    const frac = Math.min(1, elapsed / windowMs);
    const out = { expected: frac * 100, frac, hitAt: null, projected: null };
    if (pct > 0 && frac >= 0.05) {
      const rate = pct / elapsed;
      const toFull = (100 - pct) / rate;
      if (pct < 100 && now + toFull < resetsAt) out.hitAt = now + toFull;
      out.projected = pct + rate * (resetsAt - now);
    }
    return out;
  };

  /* ---------- formatting ---------- */

  Tick.fmtDuration = function (ms) {
    if (ms <= 0) return 'now';
    const m = Math.round(ms / MIN);
    if (m < 1) return '<1m';
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h < 24) return mm ? `${h}h ${mm}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh ? `${d}d ${hh}h` : `${d}d`;
  };

  Tick.fmtClock = function (t) {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  Tick.fmtDayClock = function (t, now = Date.now()) {
    const d = new Date(t);
    const today = new Date(now);
    const dayDiff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / DAY);
    if (dayDiff === 0) return Tick.fmtClock(t);
    if (dayDiff === 1) return 'tomorrow ' + Tick.fmtClock(t);
    if (dayDiff > 1 && dayDiff < 7) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + Tick.fmtClock(t);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  Tick.fmtDate = function (t) {
    return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  /** Compact reset text for the inline meter. */
  Tick.fmtResetShort = function (resetsAt, style, now = Date.now()) {
    if (!resetsAt) return null;
    const rel = resetsAt - now;
    if (rel <= 0) return 'resetting';
    if (style === 'relative' || (style === 'smart' && rel < DAY)) return Tick.fmtDuration(rel);
    return Tick.fmtDayClock(resetsAt, now);
  };

  /** Full reset sentence for details views. */
  Tick.fmtResetLong = function (resetsAt, now = Date.now(), approx = false) {
    if (!resetsAt) return null;
    const rel = resetsAt - now;
    if (rel <= 0) return 'Resetting now';
    const when = approx ? Tick.fmtDate(resetsAt) : Tick.fmtDayClock(resetsAt, now);
    return `Resets in ${approx ? 'about ' : ''}${Tick.fmtDuration(rel)} · ${when}`;
  };

  Tick.fmtAgo = function (t, now = Date.now()) {
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  };

  const fmtCache = new Map();
  function currencyFmt(currency, whole) {
    const key = currency + (whole ? ':0' : '');
    if (!fmtCache.has(key)) {
      let f;
      try {
        f = new Intl.NumberFormat(undefined, { style: 'currency', currency, ...(whole ? { maximumFractionDigits: 0 } : {}) });
      } catch (_) {
        f = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
      }
      fmtCache.set(key, f);
    }
    return fmtCache.get(key);
  }

  /** Minor units → display. Respects zero-decimal currencies (JPY etc). */
  Tick.fmtMoney = function (minor, currency = 'USD', { whole = false } = {}) {
    if (minor == null) return '—';
    const f = currencyFmt(currency || 'USD', false);
    const exp = f.resolvedOptions().maximumFractionDigits;
    const major = minor / Math.pow(10, exp);
    return (whole || major >= 10000 ? currencyFmt(currency || 'USD', true) : f).format(major);
  };

  Tick.fmtPct = (p) => (p == null ? '—' : Math.round(p) + '%');
})(typeof globalThis !== 'undefined' ? globalThis : self);
