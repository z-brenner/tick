// Mock claude.ai: a page shaped like the real composer, plus the usage endpoints, per scenario.
// Scenario picked with ?s=<name> (sticky via cookie), theme with ?theme=dark|light.
const https = require('https');
const fs = require('fs');
const path = require('path');

const PERSONAL = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const ENT = '33333333-3333-4333-8333-333333333333';

const H = 3600e3;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

const ORGS = {
  [PERSONAL]: { uuid: PERSONAL, name: 'you@example.com’s Organization', capabilities: ['chat', 'claude_max'], rate_limit_tier: 'default_claude_max_5x', raven_type: null, billing_type: 'stripe_subscription' },
  [TEAM]: { uuid: TEAM, name: 'Acme Labs', capabilities: ['chat', 'raven'], rate_limit_tier: 'default_raven', raven_type: 'team', billing_type: 'stripe_subscription' },
  [ENT]: { uuid: ENT, name: 'Northwind Corp', capabilities: ['chat', 'raven'], rate_limit_tier: 'default_raven', raven_type: 'enterprise', billing_type: 'usage_based' }
};

const L = (kind, percent, resetMs, scope = null, extra = {}) => ({
  kind,
  group: kind === 'session' ? 'session' : 'weekly',
  percent,
  severity: 'normal',
  resets_at: resetMs == null ? null : iso(resetMs),
  scope,
  is_active: true,
  ...extra
});
const fable = { model: { id: null, display_name: 'Fable' }, surface: null };

// Each scenario: which org is active, and a usage factory (bump = completions so far).
const SCENARIOS = {
  pro: {
    org: PERSONAL,
    orgOverride: { capabilities: ['chat', 'claude_pro'], rate_limit_tier: 'default_claude_ai' },
    usage: (b) => ({
      five_hour: { utilization: 42 + b * 3, resets_at: iso(2 * H + 14 * 60e3) },
      seven_day: { utilization: 18 + b, resets_at: iso(4 * 24 * H + 3 * H) },
      limits: [L('session', 42 + b * 3, 2 * H + 14 * 60e3), L('weekly_all', 18 + b, 4 * 24 * H + 3 * H)],
      spend: null
    })
  },
  max: {
    org: PERSONAL,
    usage: (b) => ({
      five_hour: null,
      seven_day: null,
      limits: [L('session', 31 + b * 3, 3 * H + 5 * 60e3), L('weekly_all', 46, 2 * 24 * H + 7 * H), L('weekly_scoped', 84, 2 * 24 * H + 7 * H, fable)],
      spend: { enabled: true, used: { amount_minor: 0, currency: 'USD' }, limit: { amount_minor: 5000, currency: 'USD' } }
    })
  },
  ultra: {
    org: PERSONAL,
    orgOverride: { rate_limit_tier: 'default_claude_max_20x' },
    usage: () => ({
      five_hour: null,
      seven_day: { utilization: 47.0, resets_at: iso(3 * 24 * H) },
      limits: [L('weekly_all', 47, 3 * 24 * H), L('weekly_scoped', 2, 3 * 24 * H, fable, { is_active: false })]
    })
  },
  team: {
    org: TEAM,
    usage: (b) => ({ limits: [L('session', 77 + b * 3, 58 * 60e3), L('weekly_all', 35, 5 * 24 * H)], spend: null })
  },
  near: {
    org: PERSONAL,
    orgOverride: { capabilities: ['chat', 'claude_pro'], rate_limit_tier: 'default_claude_ai' },
    usage: () => ({ limits: [L('session', 93, 47 * 60e3), L('weekly_all', 61, 1 * 24 * H + 2 * H)] })
  },
  maxed: {
    org: PERSONAL,
    usage: () => ({
      limits: [L('session', 100, 1 * H + 12 * 60e3), L('weekly_all', 88, 2 * 24 * H)],
      spend: { enabled: true, used: { amount_minor: 1240, currency: 'USD' }, limit: { amount_minor: 5000, currency: 'USD' } }
    })
  },
  'ent-capped': {
    org: ENT,
    usage: (b) => ({
      five_hour: null,
      seven_day: null,
      limits: [],
      spend: { enabled: true, used: { amount_minor: 14218 + b * 37, currency: 'USD' }, limit: { amount_minor: 50000, currency: 'USD' } }
    })
  },
  'ent-uncapped': {
    org: ENT,
    usage: () => ({ five_hour: null, seven_day: null, limits: [], spend: null, extra_usage: null }),
    memberSpend: () => ({ currency: 'usd', totals: [{ product_surface: 'claude_ai', cost_minor_units: 18456.78 }, { product_surface: 'claude_code', cost_minor_units: 5000 }] })
  },
  free: {
    org: PERSONAL,
    orgOverride: { capabilities: ['chat'], rate_limit_tier: 'default_claude_ai' },
    usage: () => ({ five_hour: null, seven_day: null, seven_day_opus: null, seven_day_sonnet: null, extra_usage: null, limits: [], spend: null })
  },
  legacy: {
    org: PERSONAL,
    usage: () => ({
      five_hour: { utilization: 12.0, resets_at: iso(4 * H + 20 * 60e3) },
      seven_day: { utilization: 54.0, resets_at: iso(6 * 24 * H) },
      seven_day_opus: { utilization: 81.0, resets_at: iso(6 * 24 * H) },
      extra_usage: { is_enabled: false }
    })
  },
  error: { org: PERSONAL, usage: () => ({ __status: 500 }) }
};

const stats = { usage: 0, orgs: 0, memberSpend: 0, overage: 0, completion: 0, perform: 0 };
const bumps = {};
let forcedOrg = null; // simulate the org switcher

function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(/;\s*/).forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const PAGE = fs.readFileSync(path.join(__dirname, 'page.html'), 'utf8');

const server = https.createServer({ key: fs.readFileSync(path.join(__dirname, 'key.pem')), cert: fs.readFileSync(path.join(__dirname, 'cert.pem')) }, (req, res) => {
  const url = new URL(req.url, 'https://claude.ai');
  const c = cookies(req);
  const sName = url.searchParams.get('s') || c.um_s || 'pro';
  const sc = SCENARIOS[sName] || SCENARIOS.pro;
  const p = url.pathname;

  if (p === '/__stats') return json(res, 200, { stats, bumps });
  if (p === '/__reset') {
    Object.keys(stats).forEach((k) => (stats[k] = 0));
    Object.keys(bumps).forEach((k) => delete bumps[k]);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/organizations') {
    stats.orgs++;
    return json(res, 200, Object.values(ORGS).map((o) => (o.uuid === sc.org && sc.orgOverride ? { ...o, ...sc.orgOverride } : o)));
  }

  let m = p.match(/^\/api\/organizations\/([^/]+)\/usage$/);
  if (m) {
    stats.usage++;
    const org = m[1];
    // Usage for an org other than the scenario's: reuse a plausible scenario for that org.
    const use = org === sc.org ? sc : org === TEAM ? SCENARIOS.team : org === ENT ? SCENARIOS['ent-capped'] : SCENARIOS.pro;
    const body = use.usage(org === sc.org ? bumps[sName] || 0 : 0);
    if (body.__status) return json(res, body.__status, { error: 'boom' });
    return json(res, 200, body);
  }
  m = p.match(/^\/api\/organizations\/([^/]+)\/usage\/spend$/);
  if (m) {
    stats.memberSpend++;
    if (sc.memberSpend) return json(res, 200, sc.memberSpend());
    return json(res, 404, { error: 'not found' });
  }
  m = p.match(/^\/api\/organizations\/([^/]+)\/overage_spend_limit$/);
  if (m) {
    stats.overage++;
    return json(res, 200, { is_enabled: false });
  }
  m = p.match(/^\/api\/organizations\/([^/]+)\/chat_conversations\/([^/]+)\/completion$/);
  if (m && req.method === 'POST') {
    stats.completion++;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    let i = 0;
    const t = setInterval(() => {
      res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"chunk ${i}"}}\n\n`);
      if (++i >= 6) {
        clearInterval(t);
        bumps[sName] = (bumps[sName] || 0) + 1;
        res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      }
    }, 200);
    return;
  }
  if (p.endsWith('ConversationService/PerformAction')) {
    stats.perform++;
    res.writeHead(200, { 'content-type': 'application/proto' });
    return res.end('');
  }
  if (p === '/__switch') {
    forcedOrg = url.searchParams.get('org');
    return json(res, 200, { ok: true });
  }

  // Pages
  const theme = url.searchParams.get('theme') || c.um_theme || 'light';
  const set = [`um_s=${sName}; Path=/`, `um_theme=${theme}; Path=/`, `lastActiveOrg=${forcedOrg || sc.org}; Path=/; SameSite=Lax; Secure`];
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': set });
  res.end(PAGE.replace(/__THEME__/g, theme).replace(/__ORG__/g, sc.org).replace(/__MODEL__/g, sName === 'max' ? 'Fable 5.2' : 'Opus 5.5'));
});

server.listen(8443, '127.0.0.1', () => console.log('mock claude.ai on 8443'));
