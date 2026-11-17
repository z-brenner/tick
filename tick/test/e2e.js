// End-to-end: real Chrome, real extension, mock claude.ai. Screenshots go to test/shots.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXT = path.resolve(__dirname, '../extension');
const OUT = path.resolve(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const TEAM = '22222222-2222-4222-8222-222222222222';

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Hit the mock from inside the page so Chrome's host mapping applies.
const mock = (page, p) => page.evaluate((u) => fetch(u).then((r) => r.json()), p);

async function meterInfo(page) {
  return page.evaluate(() => {
    const h = document.querySelector('[data-tick]');
    if (!h || !h.shadowRoot) return null;
    const sr = h.shadowRoot;
    const box = document.querySelector('.bg-surface-3').getBoundingClientRect();
    const mr = h.getBoundingClientRect();
    return {
      theme: h.getAttribute('data-theme'),
      size: h.getAttribute('data-size'),
      text: sr.querySelector('.bar').innerText.replace(/\s+/g, ' ').trim(),
      items: [...sr.querySelectorAll('.item')].map((n) => ({ key: n.dataset.key, sev: n.dataset.sev, val: n.querySelector('.val').textContent })),
      note: sr.querySelector('.note') && sr.querySelector('.note').textContent,
      dot: (() => { const d = sr.querySelector('.dot'); return d && !d.hidden ? d.getAttribute('data-state') : null; })(),
      gap: mr.top - box.bottom,
      leftDelta: Math.abs(mr.left - box.left),
      insideDock: !!h.closest('#sticky'),
      rect: { x: Math.min(box.left, mr.left), y: box.top, w: Math.max(box.width, mr.width), h: mr.bottom - box.top }
    };
  });
}

async function waitMeter(page, pred = () => true, timeout = 8000) {
  const t0 = Date.now();
  let info = null;
  while (Date.now() - t0 < timeout) {
    info = await meterInfo(page).catch(() => null);
    if (info && (info.items.length || info.note) && pred(info)) return info;
    await sleep(150);
  }
  return info;
}

async function shot(page, info, file, pad = 20) {
  const r = info.rect;
  await page.screenshot({ path: path.join(OUT, file), clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2 } });
}

(async () => {
  const profile = fs.mkdtempSync('/tmp/um-profile-');
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1000, height: 720 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--host-resolver-rules=MAP claude.ai:443 127.0.0.1:8443',
      '--no-proxy-server',
      '--ignore-certificate-errors'
    ]
  });

  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
  const extId = sw.url().split('/')[2];
  check('extension loads (service worker up)', !!extId, extId);

  const errors = [];
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await sleep(800);
  for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {}); // the install welcome tab

  const scenarios = [
    ['pro', (i) => i.items.some((x) => x.key === 'session') && i.items.some((x) => x.key === 'weekly')],
    ['max', (i) => i.items.some((x) => x.key === 'weekly:fable')],
    ['ultra', (i) => !i.items.some((x) => x.key === 'session') && i.items.some((x) => x.key === 'weekly')],
    ['team', (i) => i.items.find((x) => x.key === 'session')?.sev === 'warn'],
    ['near', (i) => i.items.find((x) => x.key === 'session')?.sev === 'crit'],
    ['maxed', (i) => i.items.find((x) => x.key === 'session')?.sev === 'max' && i.items.some((x) => x.key === 'credits')],
    ['ent-capped', (i) => i.items.some((x) => x.key === 'spend') && /\$142/.test(i.text)],
    ['ent-uncapped', (i) => /\$234\.57/.test(i.text) && /no cap/.test(i.text)],
    ['free', (i) => /Free plan/.test(i.note || '')],
    ['legacy', (i) => i.items.some((x) => x.key === 'session') && i.items.some((x) => x.key === 'weekly:opus')],
    // Cached data from earlier stays up with an error dot; with no cache, an "unavailable" note.
    ['error', (i) => /unavailable/i.test(i.note || '') || i.dot === 'error']
  ];

  for (const theme of ['light', 'dark']) {
    for (const [name, pred] of scenarios) {
      await page.goto(`https://claude.ai/chat/abc?s=${name}&theme=${theme}`);
      const info = await waitMeter(page, pred);
      await sleep(1100); // let the fill animation settle
      const ok = !!info && pred(info);
      if (theme === 'light') check(`scenario ${name}`, ok, info ? info.text : 'no meter');
      if (info) await shot(page, (await meterInfo(page)) || info, `${name}-${theme}.png`);
      if (name === 'pro') {
        check(`placement under chat box (${theme})`, info && info.gap >= 0 && info.gap < 24 && info.leftDelta < 2 && info.insideDock, info && `gap=${info.gap.toFixed(1)} leftΔ=${info.leftDelta.toFixed(1)} dock=${info.insideDock}`);
        check(`theme detected (${theme})`, info && info.theme === theme, info && info.theme);
      }
    }
  }

  // ---- panel + tooltip ----
  for (const theme of ['light', 'dark']) {
    await page.goto(`https://claude.ai/chat/abc?s=max&theme=${theme}`);
    await waitMeter(page, (i) => i.items.length >= 3);
    await sleep(900);
    const h = page.locator('[data-tick]');
    await h.locator('.item').first().hover();
    await sleep(300);
    const tipOn = await page.evaluate(() => document.querySelector('[data-tick]').shadowRoot.querySelector('.tip.on')?.innerText || '');
    if (theme === 'light') check('tooltip on hover', /5-hour limit/.test(tipOn), tipOn.replace(/\n/g, ' | '));
    let info = await meterInfo(page);
    await shot(page, { rect: { ...info.rect, y: info.rect.y - 90, h: info.rect.h + 90 } }, `tooltip-${theme}.png`);
    await h.locator('.more').click();
    await sleep(500);
    const panel = await page.evaluate(() => {
      const p = document.querySelector('[data-tick]').shadowRoot.querySelector('.panel');
      const r = p.getBoundingClientRect();
      return { hidden: p.hidden, text: p.innerText, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
    });
    if (theme === 'light') check('details panel opens', !panel.hidden && /Fable weekly/.test(panel.text) && /Usage credits/.test(panel.text), panel.text.split('\n').slice(0, 4).join(' | '));
    info = await meterInfo(page);
    const top = Math.min(panel.rect.y, info.rect.y) - 16;
    await page.screenshot({ path: path.join(OUT, `panel-${theme}.png`), clip: { x: info.rect.x - 16, y: top, width: info.rect.w + 32, height: info.rect.y + info.rect.h - top + 16 } });
    await page.keyboard.press('Escape');
    await sleep(200);
    const closed = await page.evaluate(() => document.querySelector('[data-tick]').shadowRoot.querySelector('.panel').hidden);
    if (theme === 'light') check('panel closes on Escape', closed);
  }

  // ---- live update after a message ----
  await mock(page, '/__reset');
  await page.goto('https://claude.ai/chat/abc?s=pro&theme=light');
  let info = await waitMeter(page, (i) => i.items.some((x) => x.key === 'session'));
  await sleep(1000);
  const before = (await meterInfo(page)).items.find((x) => x.key === 'session').val;
  const hitsBefore = (await mock(page, '/__stats')).stats.usage;
  await page.evaluate(() => window.__send());
  info = await waitMeter(page, (i) => i.items.find((x) => x.key === 'session')?.val === '45%', 7000);
  const hitsAfter = (await mock(page, '/__stats')).stats.usage;
  check('refreshes after a message (completion stream)', info && info.items.find((x) => x.key === 'session').val === '45%', `${before} → ${info && info.items.find((x) => x.key === 'session').val}, /usage calls +${hitsAfter - hitsBefore}`);

  // ---- SPA re-render ----
  await page.evaluate(() => window.__rerender());
  await sleep(300);
  const gone = await page.evaluate(() => !document.querySelector('[data-tick]'));
  info = await waitMeter(page, (i) => i.items.length > 0, 5000);
  check('re-mounts after composer is re-rendered', gone && info && info.gap >= 0 && info.insideDock, info ? `gap=${info.gap.toFixed(1)}` : 'not remounted');

  // ---- org switch ----
  await mock(page, `/__switch?org=${TEAM}`);
  await page.evaluate((id) => (document.cookie = `lastActiveOrg=${id}; path=/; Secure`), TEAM);
  info = await waitMeter(page, (i) => i.items.find((x) => x.key === 'session')?.val === '77%', 7000);
  check('follows org switch (personal → Team)', info && info.items.find((x) => x.key === 'session')?.val === '77%', info && info.text);
  await mock(page, '/__switch?org=');

  // ---- narrow composer ----
  await page.setViewportSize({ width: 430, height: 720 });
  await page.goto('https://claude.ai/chat/abc?s=pro&theme=light');
  info = await waitMeter(page);
  await sleep(1000);
  info = await meterInfo(page);
  check('compact layout on narrow widths', ['s', 'xs'].includes(info.size), `size=${info.size} "${info.text}"`);
  await shot(page, info, 'narrow-light.png', 12);
  await page.setViewportSize({ width: 1000, height: 720 });

  // ---- background: badge, notifications, storage ----
  await page.goto('https://claude.ai/chat/abc?s=near&theme=light');
  await waitMeter(page, (i) => i.items.find((x) => x.key === 'session')?.sev === 'crit');
  await sleep(800);
  sw = ctx.serviceWorkers()[0];
  const bg = await sw.evaluate(async () => ({
    badge: await chrome.action.getBadgeText({}),
    title: await chrome.action.getTitle({}),
    notified: Object.keys((await chrome.storage.local.get('notified')).notified || {}),
    alarms: (await chrome.alarms.getAll()).map((a) => a.name.split('|').slice(0, 3).join('|')),
    accounts: Object.values((await chrome.storage.local.get('accounts')).accounts || {}).map((a) => `${a.label} (${a.plan})`)
  }));
  check('toolbar badge shows binding limit', bg.badge === '93', `badge=${bg.badge} title="${bg.title}"`);
  check('warn notification fired once for 93%', bg.notified.some((k) => k.endsWith('|session|' + k.split('|')[2] + '|warn') || /\|session\|.*\|warn$/.test(k)), bg.notified.join(', '));
  check('reset reminder scheduled', bg.alarms.some((a) => a.includes('|session')), bg.alarms.join(', '));
  check('accounts remembered separately', bg.accounts.length >= 3, bg.accounts.join(', '));

  // ---- settings propagate live ----
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, showMeter: false } });
  });
  await sleep(600);
  const hidden = await page.evaluate(() => !document.querySelector('[data-tick]'));
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, showMeter: true } });
  });
  info = await waitMeter(page, () => true, 4000);
  check('toggle in options hides/shows meter live', hidden && !!info);

  // ---- popup ----
  for (const theme of ['light', 'dark']) {
    await sw.evaluate((t) => chrome.storage.local.set({ theme: t }), theme);
    await page.goto(`https://claude.ai/chat/abc?s=max&theme=${theme}`);
    await waitMeter(page, (i) => i.items.length >= 3);
    const pop = await ctx.newPage();
    await pop.setViewportSize({ width: 372, height: 900 });
    await pop.goto(`chrome-extension://${extId}/popup/popup.html`);
    await sleep(1500);
    // Render as the real popup would (not the options-tab layout).
    await pop.evaluate(() => document.body.classList.remove('tab'));
    const ptxt = await pop.evaluate(() => document.body.innerText);
    if (theme === 'light') check('popup lists accounts + details', /Personal/.test(ptxt) && /Northwind Corp/.test(ptxt) && /Fable weekly/.test(ptxt), ptxt.split('\n').slice(0, 6).join(' | '));
    const h = await pop.evaluate(() => document.querySelector('main').getBoundingClientRect().height);
    await pop.screenshot({ path: path.join(OUT, `popup-${theme}.png`), clip: { x: 0, y: 0, width: 372, height: Math.ceil(h) } });
    if (theme === 'light') {
      // switch to the Enterprise account in the popup
      await pop.getByRole('button', { name: /Northwind/ }).click();
      await sleep(900);
      const etxt = await pop.evaluate(() => document.querySelector('#details').innerText);
      check('popup switches to org account', /Monthly spend/.test(etxt), etxt.split('\n').slice(0, 4).join(' | '));
      const h2 = await pop.evaluate(() => document.querySelector('#details').getBoundingClientRect());
      await pop.screenshot({ path: path.join(OUT, `popup-enterprise-light.png`), clip: { x: 0, y: 0, width: 372, height: Math.ceil(h2.bottom + 12) } });
    }
    await pop.close();
  }

  const extErrors = errors.filter((e) => !/Failed to load resource/.test(e));
  check('no console errors from the extension', extErrors.length === 0, extErrors.slice(0, 3).join(' || '));

  await ctx.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
