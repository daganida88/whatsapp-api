# Zombie State Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the WhatsApp API from silently entering a zombie state where messages stop arriving but Docker reports healthy.

**Architecture:** Three layered fixes in a single file (`src/index.js`): (1) detect Puppeteer page navigations that destroy event listeners and restart the client, (2) replace the always-200 health endpoint with one that probes WhatsApp connection state, (3) add periodic heartbeat logging and structured event logs for post-incident debugging.

**Tech Stack:** Node.js, Express, whatsapp-web.js, Puppeteer

---

## File Structure

All changes are in a single file:

- **Modify:** `src/index.js` — client lifecycle, health endpoint, page guards, logging

No new files. No test files (project has no test framework configured).

---

## Task 1: Add Observability State and Utility Function

**Files:**
- Modify: `src/index.js:96` (near existing globals), `src/index.js:98-135` (inside `createClient()`)

This task adds the state variables and helper that all subsequent tasks depend on.

- [ ] **Step 1: Add global state variables**

After the existing `let client;` on line 96, add the observability globals:

```js
let client;
let messageCount = 0;
let clientCreatedAt = null;
let lastRestartReason = null;
let heartbeatInterval = null;
```

- [ ] **Step 2: Add `formatUptime()` utility function**

Add this right after the new globals (before `async function createClient()`):

```js
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}
```

- [ ] **Step 3: Reset counters in `createClient()`**

Inside `createClient()`, right after the opening `console.log('🚀 Creating WhatsApp client...');` on line 99, add:

```js
async function createClient() {
  console.log('🚀 Creating WhatsApp client...');
  messageCount = 0;
  clientCreatedAt = Date.now();
```

- [ ] **Step 4: Verify the server starts**

Run: `cd /Users/idan/Repositories/whatsapp-api && node -c src/index.js`
Expected: No syntax errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/idan/Repositories/whatsapp-api
git add src/index.js
git commit -m "feat: add observability state variables and formatUptime utility"
```

---

## Task 2: Enhance `scheduleRestart()` with Reason Tracking

**Files:**
- Modify: `src/index.js:386-401` (`scheduleRestart` function)
- Modify: `src/index.js:142` (caller in `guardPage` — page error)
- Modify: `src/index.js:149` (caller in `guardPage` — page close)
- Modify: `src/index.js:163` (caller in `guardPage` — browser disconnected)
- Modify: `src/index.js:190` (caller in `startWatchdog`)
- Modify: `src/index.js:209` (caller in `attachClientHandlers` — disconnected event)

This task must be done before Task 3 (framenavigated) because Task 3 calls `scheduleRestart('navigation')`.

- [ ] **Step 1: Update `scheduleRestart()` to accept a reason**

Replace the entire `scheduleRestart` function (lines 386-401) with:

```js
function scheduleRestart(reason = 'unknown') {
  if (restartTimer) {
    console.log(`🔄 [RESTART] Already scheduled, skipping duplicate (pending reason: ${lastRestartReason})`);
    return;
  }
  lastRestartReason = reason;
  const uptime = clientCreatedAt ? formatUptime(Date.now() - clientCreatedAt) : 'n/a';
  console.log(`🔄 [RESTART] Scheduling restart in 2s — reason=${reason} uptime=${uptime} messages=${messageCount}`);
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    console.log(`🔄 [LIFECYCLE] Destroying old client — reason=${reason} uptime=${uptime} messages=${messageCount}`);
    try {
      await client.destroy().catch(() => {});
    } catch (_) {}
    console.log('🔄 [LIFECYCLE] Creating new client...');
    createClient();
  }, 2000);
}
```

- [ ] **Step 2: Update all existing callers to pass a reason**

In `guardPage()`, update the three callers:

1. Page crash handler (line ~142):
```js
  page.on('error', err => {
    console.error('🛡️ [LIFECYCLE] Puppeteer page crashed:', err.message);
    scheduleRestart('page_crash');
  });
```

2. Page close handler (line ~149):
```js
  page.on('close', () => {
    console.warn('🛡️ [LIFECYCLE] Puppeteer page was closed unexpectedly');
    scheduleRestart('page_closed');
  });
```

3. Browser disconnected handler (line ~163):
```js
  const browser = page.browser();
  browser.on('disconnected', () => {
    console.warn('🛡️ [LIFECYCLE] Browser process disconnected');
    scheduleRestart('browser_disconnected');
  });
```

In `startWatchdog()`, update the caller (line ~190):
```js
      } catch (error) {
          console.error('🚨 [WATCHDOG] Browser is unresponsive/stuck. Restarting...');
          scheduleRestart('watchdog_timeout');
      }
```

In `attachClientHandlers()`, update the disconnected handler (line ~209):
```js
  client.on('disconnected', reason => {
    console.warn(`${ts()} ⚠️ [LIFECYCLE] Client disconnected: ${reason}`);
    clientReady = false;
    scheduleRestart('client_disconnected');
  });
```

- [ ] **Step 3: Verify no syntax errors**

Run: `cd /Users/idan/Repositories/whatsapp-api && node -c src/index.js`
Expected: No syntax errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/idan/Repositories/whatsapp-api
git add src/index.js
git commit -m "feat: add restart reason tracking to scheduleRestart"
```

---

## Task 3: Add `framenavigated` Detection to `guardPage()` (Primary Zombie Fix)

**Files:**
- Modify: `src/index.js:137-165` (`guardPage` function)

This is the most important change — it detects the page navigation that causes the zombie state and triggers a restart.

- [ ] **Step 1: Add `framenavigated` listener to `guardPage()`**

At the end of the `guardPage()` function, after the `browser.on('disconnected', ...)` handler (line ~165) but before the closing `}`, add:

```js
  // PRIMARY ZOMBIE FIX: Detect WhatsApp Web internal SPA navigations.
  // When WhatsApp Web navigates internally, the Puppeteer execution context
  // is destroyed and recreated. The library re-injects Store, but Node.js-side
  // message event listeners are silently dropped — causing the zombie state.
  // See: https://github.com/wwebjs/whatsapp-web.js/issues/127049
  const mainFrame = page.mainFrame();
  page.on('framenavigated', (frame) => {
    if (frame !== mainFrame) return; // Ignore iframe navigations
    const url = frame.url();
    console.log(`🔄 [NAVIGATION] Main frame navigated to ${url} — triggering restart`);
    scheduleRestart('navigation');
  });
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /Users/idan/Repositories/whatsapp-api && node -c src/index.js`
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/idan/Repositories/whatsapp-api
git add src/index.js
git commit -m "feat: detect WhatsApp Web page navigation and restart to prevent zombie state"
```

---

## Task 4: Replace Health Check with Connection-Aware Version

**Files:**
- Modify: `src/index.js:457-463` (`/health` endpoint)

- [ ] **Step 1: Replace the `/health` endpoint**

Replace the existing health endpoint (lines 457-463):

```js
// Health check endpoint (protected)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});
```

With the connection-aware version:

```js
// Health check endpoint — Docker uses this to decide whether to restart the container.
// Returns 200 only if WhatsApp is fully connected; 503 otherwise.
app.get('/health', async (req, res) => {
  const timestamp = new Date().toISOString();

  // Check 1: Has the client emitted 'ready'?
  if (!clientReady) {
    console.log('[HEALTH] FAIL check=clientReady result=false — returning 503');
    return res.status(503).json({
      status: 'unhealthy',
      check: 'clientReady',
      clientReady: false,
      timestamp
    });
  }

  // Check 2: Does the session have authenticated user info?
  if (!client || !client.info) {
    console.log('[HEALTH] FAIL check=clientInfo result=missing — returning 503');
    return res.status(503).json({
      status: 'unhealthy',
      check: 'clientInfo',
      hasInfo: false,
      timestamp
    });
  }

  // Check 3: Does WhatsApp Web report CONNECTED? (5s timeout)
  try {
    const stateTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 5000)
    );
    const state = await Promise.race([
      client.getState(),
      stateTimeout
    ]);

    if (state !== 'CONNECTED') {
      console.log(`[HEALTH] FAIL check=getState result=${state} — returning 503`);
      return res.status(503).json({
        status: 'unhealthy',
        check: 'getState',
        state: state,
        timestamp
      });
    }

    // All checks passed
    const uptime = clientCreatedAt ? formatUptime(Date.now() - clientCreatedAt) : 'n/a';
    res.json({
      status: 'ok',
      state,
      uptime,
      messages: messageCount,
      timestamp,
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (err) {
    console.log('[HEALTH] FAIL check=getState result=TIMEOUT — returning 503');
    return res.status(503).json({
      status: 'unhealthy',
      check: 'getState',
      error: 'timeout',
      timestamp
    });
  }
});
```

- [ ] **Step 2: Verify no syntax errors**

Run: `cd /Users/idan/Repositories/whatsapp-api && node -c src/index.js`
Expected: No syntax errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/idan/Repositories/whatsapp-api
git add src/index.js
git commit -m "feat: replace always-200 health check with connection-aware version"
```

---

## Task 5: Add Heartbeat Logging

**Files:**
- Modify: `src/index.js` — add `startHeartbeat()` function near `startWatchdog()`, call it from `createClient()`

- [ ] **Step 1: Add `startHeartbeat()` function**

Add this function right after `startWatchdog()` (after line ~194):

```js
function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  heartbeatInterval = setInterval(async () => {
    const uptime = clientCreatedAt ? formatUptime(Date.now() - clientCreatedAt) : 'n/a';

    if (!clientReady || !client) {
      console.log(`💓 [HEARTBEAT] state=NOT_READY clientReady=${clientReady} uptime=${uptime} messages=${messageCount}`);
      return;
    }

    try {
      const stateTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );
      const state = await Promise.race([
        client.getState(),
        stateTimeout
      ]);
      console.log(`💓 [HEARTBEAT] state=${state} clientReady=${clientReady} uptime=${uptime} messages=${messageCount}`);
    } catch (err) {
      console.log(`💓 [HEARTBEAT] state=PROBE_FAILED clientReady=${clientReady} uptime=${uptime} messages=${messageCount}`);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}
```

- [ ] **Step 2: Call `startHeartbeat()` from `createClient()`**

In `createClient()`, the existing code calls `startWatchdog()` on line ~134. Add `startHeartbeat()` right after it:

```js
  client.initialize().catch(err => {
    console.error('❌ client.initialize() threw:', err.message);
    console.error(err.stack);
  });
  startWatchdog();
  startHeartbeat();
}
```

- [ ] **Step 3: Verify no syntax errors**

Run: `cd /Users/idan/Repositories/whatsapp-api && node -c src/index.js`
Expected: No syntax errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/idan/Repositories/whatsapp-api
git add src/index.js
git commit -m "feat: add periodic heartbeat logging every 5 minutes"
```

---

## Task 6: Enhance Event Handler Logging and Wire Up Message Counter

**Files:**
- Modify: `src/index.js:196-382` (`attachClientHandlers` function)

- [ ] **Step 1: Wire up message counter**

In `attachClientHandlers()`, inside the `client.on('message', async (msg) => {` handler (line ~293), add `messageCount++` as the very first line inside the callback:

```js
      client.on('message', async (msg) => {
          messageCount++;
          // console.log('📨 Message received - ALL FIELDS:', JSON.stringify(msg, null, 2));
          console.log('📨 Message received:', {
```

- [ ] **Step 2: Enhance the `ready` handler logging**

Replace the existing `ready` handler (line ~200-206):

```js
  client.on('ready', () => {
    console.log(`${ts()} ✅ WhatsApp client is ready!`);
    clientReady = true;
    const page = client.pupPage;
    guardPage(page);
    startGroupPurge(client)
    startAutoPurge(client);
  });
```

With:

```js
  client.on('ready', () => {
    const pushname = client.info?.pushname || 'unknown';
    const wid = client.info?.wid?._serialized || 'unknown';
    console.log(`${ts()} ✅ [LIFECYCLE] WhatsApp client is ready — user=${pushname} wid=${wid} lastRestart=${lastRestartReason || 'initial'}`);
    clientReady = true;
    const page = client.pupPage;
    guardPage(page);
    startGroupPurge(client)
    startAutoPurge(client);
  });
```

- [ ] **Step 3: Enhance the `change_state` handler**

Replace the existing handler (line ~224):

```js
  client.on('change_state', state => {
    console.log(`${ts()} 🔄 Client state changed: ${state}`);
  });
```

With:

```js
  client.on('change_state', state => {
    console.log(`${ts()} 🔄 [STATE] Client state changed: ${state}`);
    if (state === 'CONFLICT' || state === 'UNLAUNCHED' || state === 'TIMEOUT') {
      console.warn(`${ts()} ⚠️ [STATE] Problematic state detected: ${state}`);
    }
  });
```

- [ ] **Step 4: Verify no syntax errors**

Run: `cd /Users/idan/Repositories/whatsapp-api && node -c src/index.js`
Expected: No syntax errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/idan/Repositories/whatsapp-api
git add src/index.js
git commit -m "feat: enhance event logging with structured prefixes and message counter"
```

---

## Task 7: Verify `startAutoPurge` Reference

**Files:**
- Modify: none (verification only)

The existing code on line 207 calls `startAutoPurge(client)` but this function is not defined anywhere in `src/index.js`. Only `startGroupPurge` is defined (line 238). This is likely a bug in the existing code — either a missing function or a duplicate call.

- [ ] **Step 1: Search for `startAutoPurge` definition**

Run: `cd /Users/idan/Repositories/whatsapp-api && grep -rn 'startAutoPurge' src/`

If it's not defined anywhere, it will throw a ReferenceError when the client becomes ready. Check if it should be removed or if `startGroupPurge` is the intended function.

- [ ] **Step 2: Fix if needed**

If `startAutoPurge` is not defined, remove the call from the `ready` handler. The line to remove would be:
```js
    startAutoPurge(client);
```

- [ ] **Step 3: Commit if changed**

```bash
cd /Users/idan/Repositories/whatsapp-api
git add src/index.js
git commit -m "fix: remove undefined startAutoPurge call from ready handler"
```

---

## Verification Checklist

After all tasks are complete, verify end-to-end:

- [ ] `node -c src/index.js` — no syntax errors
- [ ] `docker compose build` — image builds successfully
- [ ] `docker compose up` — container starts, client initializes
- [ ] Check logs for `[LIFECYCLE]` messages during startup
- [ ] Wait 5 minutes, verify `[HEARTBEAT]` log appears
- [ ] `curl http://localhost:3001/health` — returns 200 with `state: CONNECTED` once client is ready
- [ ] `curl http://localhost:3001/health` during initialization — returns 503
