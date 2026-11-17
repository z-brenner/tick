const assert = require('assert');
require('../extension/shared/core.js');
const Tick = globalThis.Tick;
const now = Date.parse('2026-11-01T12:00:00Z');

// Ultra (real shape from issue #356): no 5-hour, weekly + Fable scoped
let s = Tick.buildSnapshot({ orgId: 'x', org: { capabilities: ['chat','claude_max'], rate_limit_tier: 'default_claude_max_20x' }, now, usage: {
  five_hour: null, seven_day: { utilization: 47.0, resets_at: '2026-11-03T17:00:00.036205+00:00' }, seven_day_opus: null, seven_day_sonnet: null, seven_day_omelette: null,
  limits: [ { kind: 'weekly_all', group: 'weekly', percent: 47, severity: 'normal', resets_at: '2026-11-03T17:00:00.036205+00:00', scope: null, is_active: true },
            { kind: 'weekly_scoped', group: 'weekly', percent: 2, severity: 'normal', resets_at: '2026-11-03T17:00:00.036349+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false } ] } });
assert.equal(s.mode, 'rate'); assert.equal(s.plan.label, 'Ultra');
assert.deepEqual(s.limits.map(l => l.id), ['weekly', 'weekly:fable']);
assert.equal(s.limits[1].label, 'Fable weekly');
assert.equal(Tick.primaryReading(s).id, 'weekly');

// Free: everything null
s = Tick.buildSnapshot({ orgId: 'x', org: { capabilities: ['chat'] }, now, usage: {"five_hour":null,"seven_day":null,"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_omelette":null,"extra_usage":null,"limits":[],"spend":null} });
assert.equal(s.mode, 'free'); assert.equal(s.limits.length, 0); assert.equal(s.spend, null);

// limits[] wins over legacy duplicates; session + weekly ordering
s = Tick.buildSnapshot({ orgId: 'x', org: null, now, usage: {
  five_hour: { utilization: 32, resets_at: '2026-11-01T15:00:00Z' }, seven_day: { utilization: 12.5, resets_at: '2026-11-03T17:00:00Z' },
  limits: [ { kind: 'weekly_all', group: 'weekly', percent: 12, resets_at: '2026-11-03T17:00:00Z' }, { kind: 'session', group: 'session', percent: 40, resets_at: '2026-11-01T15:00:00Z' } ] } });
assert.deepEqual(s.limits.map(l => [l.id, l.pct]), [['session', 40], ['weekly', 12]]);

// Legacy-only payload with Opus
s = Tick.buildSnapshot({ orgId: 'x', org: null, now, usage: { five_hour: { utilization: '12', resets_at: '2026-11-01T16:00:00Z' }, seven_day: { utilization: 54 }, seven_day_opus: { utilization: 81 }, extra_usage: { is_enabled: false } } });
assert.deepEqual(s.limits.map(l => l.id), ['session', 'weekly', 'weekly:opus']); assert.equal(s.limits[0].pct, 12); assert.equal(s.spend, null);

// Usage-based Enterprise with spend object
s = Tick.buildSnapshot({ orgId: 'x', org: { capabilities: ['chat','raven'], raven_type: 'enterprise', name: 'Northwind Corp' }, now, usage: { limits: [], spend: { enabled: true, used: { amount_minor: 14218, currency: 'usd' }, limit: { amount_minor: 50000, currency: 'usd' } } } });
assert.equal(s.mode, 'spend'); assert.equal(s.plan.label, 'Enterprise'); assert.equal(Tick.accountLabel(s), 'Northwind Corp');
assert.equal(Math.round(s.spend.pct * 100) / 100, 28.44); assert.equal(s.spend.currency, 'USD'); assert.ok(s.spend.resetsApprox);

// Enterprise without spend in /usage, member spend from /usage/spend; no cap
const ms = Tick.parseMemberSpend({ currency: 'usd', totals: [{ cost_minor_units: 123456.78 }, { cost_minor_units: 100 }] });
s = Tick.buildSnapshot({ orgId: 'x', org: { capabilities: ['chat','raven'], raven_type: 'enterprise' }, now, usage: { limits: [] }, memberSpend: ms });
assert.equal(s.mode, 'spend'); assert.equal(s.spend.usedMinor, 123556.78); assert.equal(s.spend.limitMinor, null); assert.equal(s.spend.pct, null);

// Org-wide overage is ignored for org accounts, used for personal
const ov = Tick.parseOverage({ is_enabled: true, monthly_credit_limit: 5000, used_credits: 1200, currency: 'USD' });
assert.equal(Tick.buildSnapshot({ orgId: 'x', org: { raven_type: 'team', capabilities: ['chat','raven'] }, now, usage: {}, overage: ov }).spend, null);
assert.equal(Tick.buildSnapshot({ orgId: 'x', org: { capabilities: ['chat','claude_pro'] }, now, usage: {}, overage: ov }).spend.usedMinor, 1200);
// cached overage object is not mutated
assert.equal(ov.periodStart, undefined);

// Team detection, Max detection
assert.equal(Tick.planFromOrg({ raven_type: 'team', capabilities: ['chat','raven'] }).label, 'Team');
assert.equal(Tick.planFromOrg({ capabilities: ['chat','claude_max'], rate_limit_tier: 'default_claude_max_5x' }).label, 'Max');

// Pace: halfway through a 5h window at 70% -> hits before reset
const p = Tick.pace({ pct: 70, windowMs: 5 * 3600e3, resetsAt: now + 2.5 * 3600e3 }, now);
assert.equal(Math.round(p.expected), 50); assert.ok(p.hitAt && p.hitAt < now + 2.5 * 3600e3);
const q = Tick.pace({ pct: 20, windowMs: 5 * 3600e3, resetsAt: now + 2.5 * 3600e3 }, now);
assert.equal(q.hitAt, null); assert.equal(Math.round(q.projected), 40);

// Money formatting incl. zero-decimal currency
assert.equal(Tick.fmtMoney(14218, 'USD'), '$142.18');
assert.equal(Tick.fmtMoney(5000, 'JPY'), '¥5,000');
assert.equal(Tick.fmtDuration(2 * 3600e3 + 14 * 60e3), '2h 14m');

// Garbage in, nothing invented
s = Tick.buildSnapshot({ orgId: 'x', org: null, now, usage: { limits: [{ kind: 'session', percent: 'n/a' }, null, 5], five_hour: 'nope', spend: { enabled: false } } });
assert.equal(s.mode, 'unknown'); assert.equal(s.limits.length, 0);
console.log('unit: all passed');
