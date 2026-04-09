# WhatsApp API Zombie State Fix

## Problem

The WhatsApp API container enters a "zombie state" where it stops receiving messages but Docker reports it as healthy. The container remains running indefinitely in this broken state until manually restarted.

**Root cause:** whatsapp-web.js uses Puppeteer to control a Chromium tab running WhatsApp Web. WhatsApp Web is a single-page app that occasionally performs internal page navigations (SPA refreshes, IndexedDB recovery after sleep). When this happens, the Puppeteer execution context is destroyed and recreated. The library re-injects its `Store` module, but the Node.js-side `message_create` event listeners are silently dropped. The client appears connected but stops receiving messages.

**Secondary causes:**
- Chromium process crashes silently
- WhatsApp session expires or is logged out from phone
- Network issues causing actual disconnection without emitting events
- `client.initialize()` failure on startup

**Current gaps:**
- `/health` endpoint always returns 200 if Express is running — never checks WhatsApp state
- Watchdog checks if Puppeteer can evaluate `1+1` — doesn't detect listener loss
- No logging when the session degrades — the only signal is "messages stopped"

**References:**
- https://github.com/wwebjs/whatsapp-web.js/issues/127049
- https://github.com/wwebjs/whatsapp-web.js/pull/201653
- https://github.com/wwebjs/whatsapp-web.js/issues/1567

## Solution Overview

Three changes to `src/index.js`, in priority order:

1. **Listener re-attachment via page navigation detection** — primary fix for the zombie state
2. **Connection-aware health check** — safety net for all other failure modes
3. **Improved logging/observability** — periodic heartbeat and key event logging

## 1. Listener Re-attachment on Page Navigation

### What

In `guardPage()`, add a `framenavigated` listener on the Puppeteer page's main frame. When WhatsApp Web performs an internal navigation, trigger a full client restart (`scheduleRestart()`).

### Why restart instead of surgically re-attaching listeners?

Re-attaching listeners requires reaching into whatsapp-web.js internals (`window.Store.Msg`, Backbone event bindings) which is fragile and version-dependent. A full `destroy()` + `createClient()` takes ~10-15 seconds and guarantees a clean state. Since internal navigations are rare (every few hours/days), the brief downtime is acceptable.

### Behavior

1. Listen for `framenavigated` events on the Puppeteer page
2. Filter: only react to main frame navigations (ignore iframes)
3. Log the navigation event with URL for debugging
4. Call `scheduleRestart()` — debounced, so rapid navigations only trigger one restart
5. The existing `scheduleRestart()` function handles the rest: destroy old client, wait 2 seconds, create new client

### Guard rails

- **Main frame only:** Ignore iframe navigations to avoid false triggers
- **Debounce:** `scheduleRestart()` already checks `if (restartTimer) return` — no duplicate restarts
- **Logging:** Every navigation is logged so the cause of a restart is always visible in logs

### Location

Add to `guardPage()` function in `src/index.js` (after the existing `page.on('error')`, `page.on('close')`, etc. handlers).

## 2. Connection-Aware Health Check

### What

Replace the `/health` endpoint with one that checks actual WhatsApp connection state.

### Current behavior

```js
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});
```

Always returns 200. Docker thinks the container is healthy regardless of WhatsApp state.

### New behavior

Three checks, in order:

1. **`clientReady` flag** — has the client emitted `ready`?
2. **`client.info` exists** — is the session authenticated?
3. **`client.getState()` with 5s timeout** — does WhatsApp Web report `CONNECTED`?

If all pass: return **200** with status details.
If any fail: return **503** with which check failed and the actual state.

### Edge case: cold start

On startup, the client needs 30-60 seconds to initialize. Docker's `start_period: 60s` (already configured in docker-compose.yml) handles this — health check failures are ignored during that window.

### What this catches

- Browser/Chromium crashes
- WhatsApp session expiry or logout from phone
- `client.initialize()` failure
- Network disconnections
- Any state where `getState()` returns something other than `CONNECTED`

### What this does NOT catch

- The zombie state where listeners are detached but `getState()` still returns `CONNECTED` — that's handled by Section 1.

### Docker behavior

Existing healthcheck config (no changes needed):
- Interval: 30s
- Timeout: 30s
- Retries: 3
- Start period: 60s

Container restarts after ~90 seconds of unhealthy state.

## 3. Improved Logging / Observability

### Periodic Heartbeat (every 5 minutes)

Log a `[HEARTBEAT]` entry containing:
- Current WhatsApp state (result of `getState()`)
- `clientReady` flag
- Uptime since last client creation
- Message count since last client creation (simple counter incremented on each `message` event)

Purpose: When reviewing logs after an incident, the heartbeat shows the exact moment things degraded. A flatlined message count alongside a `CONNECTED` state is a clear signal of the zombie problem.

### Key Events to Log

| Event | Log prefix | Details |
|-------|-----------|---------|
| Main frame navigation detected | `[NAVIGATION]` | URL, triggering restart |
| Health check failure | `[HEALTH]` | Which check failed, actual state |
| Client restart triggered | `[RESTART]` | Reason (navigation, watchdog, disconnect, health) |
| Client state transitions | `[STATE]` | Old state -> new state (enhance existing `change_state` handler) |
| Watchdog check pass/fail | `[WATCHDOG]` | Result of browser responsiveness check |
| Client ready | `[LIFECYCLE]` | Time to ready, session info |
| Client destroyed | `[LIFECYCLE]` | Uptime, total messages processed |

### Format

Keep existing emoji-prefixed console.log style. Add bracketed prefixes for grepability:
```
[HEARTBEAT] state=CONNECTED clientReady=true uptime=3h42m messages=127
[NAVIGATION] Main frame navigated to https://web.whatsapp.com/ — triggering restart
[HEALTH] FAIL check=getState result=TIMEOUT — returning 503
[RESTART] reason=navigation uptime=3h42m messages=127
```

## Files Changed

Only `src/index.js` — all three features live in the same file where the client, health endpoint, and page handlers are defined.

## What This Does NOT Cover (Future Work)

- **Alerting:** No Slack/email/Telegram notification when things go wrong. Docker auto-restarts handle recovery silently. Can be added later.
- **Message staleness detection:** Tracking "no messages in X hours" as a health signal. Ruled out because the user has natural long quiet periods that would cause false restarts.
- **Scheduled preventive restarts:** Periodic `destroy()` + `initialize()` as a belt-and-suspenders measure. Not needed if the navigation detection works correctly.
- **Using a patched fork of whatsapp-web.js:** PR #201653 has a comprehensive fix but hasn't been merged. We implement the same concept at the application layer instead.
