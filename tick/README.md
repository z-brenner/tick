# Tick

Tick is a Chrome and Edge extension that puts a slim usage meter directly under the chat box on claude.ai. It reads your real limits from claude.ai itself, so there is nothing to configure: install it, open Claude, and the meter is there.

## Install

1. Unzip this folder somewhere permanent. Chrome loads it from disk, so don't delete it afterward.
2. Chrome: go to `chrome://extensions`. Edge: go to `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the `extension` folder, which contains `manifest.json`.
5. Pin the icon to the toolbar if you want the badge.

Any claude.ai tabs that were already open pick up the meter immediately. If none were open, a claude.ai tab opens for you.

## What it shows

The extension decides what to draw from what claude.ai reports for the signed-in account, not from the plan name. That way plan changes keep working without an update. Ultra losing its 5-hour window on October 30 is an example.

| Account | Meter under the chat box |
| --- | --- |
| Pro, Max, Team, seat-based Enterprise | 5-hour and weekly bars |
| Ultra, verified accounts | Weekly bar only, because Claude no longer reports a 5-hour window |
| Any plan with a per-model weekly cap | An extra chip for that model when you're using it or it passes 80% |
| Any plan with usage credits turned on | A credits chip once a plan limit is maxed |
| Usage-based Enterprise | Your monthly spend against your personal spend cap, or the amount alone if there's no cap |
| Free | A note that Claude doesn't report Free limits |

Each bar has a small tick, which the extension is named for, showing where even pace would put you at this point in the window. If the fill is past the tick, you're burning faster than the window allows. Bars turn amber at 75% and red at 90%.

The right side of the meter shows which account the numbers belong to: the plan for a personal account, or the organization name and plan for an org. Switching orgs in Claude's account menu switches the meter within a couple of seconds.

**Hover** any bar for the reset time and a projection. **Click** it, or the chevron, for the full breakdown: every limit, exact reset times, projections, usage credits, and a refresh button. Escape or a click elsewhere closes it.

The meter refreshes after every message, at each reset, when you come back to the tab, and every 60 seconds while the tab is visible.

## Toolbar popup and options

The toolbar icon shows the percentage for whichever limit you're closest to. The popup lists every account the extension has seen, personal and organizations, and lets you switch between them. It can refresh an account even when no claude.ai tab is open.

Options, in the popup or on the extension's options page:

- Show or hide the meter under the chat box
- Pace marker and projections on or off
- Reset times as Smart, Countdown, or Clock
- Notify at 75, 90, or 95 percent, or off. 90 is the default
- Notify when a limit you were close to resets
- Percent on the toolbar icon

## Privacy

Everything runs in your browser. The extension only talks to claude.ai, using the session you're already signed into. There is no server, no analytics, and no API key. Usage snapshots are kept in the browser's local extension storage, and settings sync through your browser profile like any extension setting.

Permissions requested: claude.ai only, plus storage, notifications, alarms for the reset reminder, and scripting to attach to tabs that were open at install time.

## How it works

The content script on claude.ai reads, with your cookies:

- `GET /api/organizations` for the plan and whether the account is personal or an org
- the `lastActiveOrg` cookie for which account is active
- `GET /api/organizations/{org}/usage` for the 5-hour, weekly, and per-model weekly limits and usage credits. Both the newer `limits` array and the older `five_hour` and `seven_day` fields are handled
- `GET /api/organizations/{org}/usage/spend` for your own month-to-date spend, only on usage-billed accounts where `/usage` didn't include it
- `GET /api/organizations/{org}/overage_spend_limit` only as a last resort for personal accounts. On Team and Enterprise this endpoint can return the organization's total, so it is never shown there as your spend

Message activity is detected from the page's own network timing entries. Both the classic `/completion` stream and the newer `PerformAction` RPC are covered. Nothing is injected into claude.ai's JavaScript and none of its requests are modified.

## Known limits

- These endpoints are undocumented. Every parser tolerates missing or renamed fields and shows nothing rather than a wrong number, but a large change on Anthropic's side will need an update.
- The usage-based Enterprise spend view was built from the response shapes that two actively maintained open-source trackers parse, and tested against mocks of those shapes. It has not yet been checked against a live Enterprise account. If your organization turns off individual usage analytics, Claude doesn't report your spend and the meter says so.
- When Claude doesn't report a spend reset date, the meter assumes the calendar month and labels the date as approximate.
- Projections are straight-line estimates from the current window and are labeled that way.
- Unpacked extensions don't auto-update, and Chrome and Edge show a developer-mode reminder at startup. Publishing to the Chrome Web Store and Edge Add-ons fixes both.
- It works in the browser only. The Claude desktop app isn't covered.

## Name

The name lives in one place: `extension/_locales/en/messages.json`. For a store listing, "Tick for Claude" in `extName` is the clearer and safer title, since it says what the extension works with without implying Anthropic made it.

## Development

No build step. Edit the files and click reload on the extensions page.

```
extension/
  manifest.json
  background.js        badge, notifications, per-account storage
  content/main.js      account detection, polling, activity detection
  content/meter.js     the meter, panel, tooltip, theme matching
  shared/core.js       parsing, plan detection, pace math, formatting
  shared/api.js        claude.ai client
  shared/details.js    breakdown view shared by the panel and popup
  popup/               toolbar popup and options page
test/
  unit.js              parser and formatting tests: node test/unit.js
  mock-server.js       fake claude.ai with every plan type
  e2e.js               loads the extension in Chrome against the mock
tools/make_icons.py    regenerates the icons: a usage bar with its pace tick
```

To run the browser tests, create a throwaway certificate, start the mock, and run the suite:

```
cd test
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 3 -subj "/CN=claude.ai" -addext "subjectAltName=DNS:claude.ai"
node mock-server.js &
cd .. && node test/e2e.js
```

The e2e script expects Playwright and a Chrome for Testing build. Branded Chrome 137 and later ignores `--load-extension`.
