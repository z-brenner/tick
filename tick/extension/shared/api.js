/*
 * Thin client for claude.ai's own (undocumented) endpoints. Requests ride the user's existing
 * claude.ai session cookies; there are no credentials to configure and nothing leaves the browser.
 *
 * In the content script `base` is '' (same origin as claude.ai). In the popup it is
 * 'https://claude.ai', which works because the extension holds host permission for claude.ai.
 */
(function (root) {
  'use strict';
  const Tick = (root.Tick = root.Tick || {});

  class HttpError extends Error {
    constructor(status, path, detail) {
      super(`${path} → ${status || 'network'}${detail ? ' (' + detail + ')' : ''}`);
      this.name = 'HttpError';
      this.status = status;
      this.path = path;
      this.detail = detail || null;
    }
  }

  const ORG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isOrgId = (id) => typeof id === 'string' && ORG_ID.test(id);

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function client(base = '') {
    async function get(path, { timeout = 12000 } = {}) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      let res;
      try {
        res = await fetch(base + '/api' + path, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: ctrl.signal
        });
      } catch (e) {
        throw new HttpError(0, path, e && e.name === 'AbortError' ? 'timeout' : 'network');
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new HttpError(res.status, path);
      const type = res.headers.get('content-type') || '';
      // A Cloudflare challenge or a login redirect comes back as HTML with a 200.
      if (!type.includes('json')) throw new HttpError(res.status, path, 'not JSON');
      try {
        return await res.json();
      } catch (_) {
        throw new HttpError(res.status, path, 'bad JSON');
      }
    }

    const org = (id) => {
      if (!isOrgId(id)) throw new HttpError(0, '/organizations/?', 'invalid org id');
      return '/organizations/' + id;
    };

    return {
      organizations: () => get('/organizations'),
      usage: (id) => get(org(id) + '/usage'),
      overage: (id) => get(org(id) + '/overage_spend_limit'),
      memberSpend: (id, now = new Date()) => {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const q = `?start_date=${ymd(start)}&end_date=${ymd(now)}&group_by=product_surface&granularity=daily`;
        return get(org(id) + '/usage/spend' + q);
      }
    };
  }

  /**
   * One full read for an org: usage first (authoritative), then spend enrichment only when
   * /usage didn't carry the dollar figure the account is actually governed by.
   * `cache` lets callers throttle the slower spend endpoints between polls.
   */
  async function readAccount(api, orgId, org, cache = {}) {
    const usage = await api.usage(orgId);
    let snap = Tick.buildSnapshot({ orgId, org, usage });

    const needsSpend = (snap.mode === 'spend' || snap.mode === 'unknown') && (!snap.spend || snap.spend.usedMinor == null);
    if (!needsSpend) return snap;

    const fresh = (k, ms) => cache[k] && Date.now() - cache[k].at < ms;
    let memberSpend = fresh('memberSpend', 5 * 60e3) ? cache.memberSpend.value : undefined;
    if (memberSpend === undefined) {
      memberSpend = await api.memberSpend(orgId).then(Tick.parseMemberSpend, () => null);
      cache.memberSpend = { at: Date.now(), value: memberSpend };
    }
    let overage = null;
    if (!memberSpend && !Tick.isOrgAccount(org)) {
      overage = fresh('overage', 5 * 60e3) ? cache.overage.value : undefined;
      if (overage === undefined) {
        overage = await api.overage(orgId).then(Tick.parseOverage, () => null);
        cache.overage = { at: Date.now(), value: overage };
      }
    }
    return Tick.buildSnapshot({ orgId, org, usage, memberSpend, overage });
  }

  Tick.api = { client, HttpError, isOrgId, readAccount };
})(typeof globalThis !== 'undefined' ? globalThis : self);
