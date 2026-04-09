const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const fetch = require('node-fetch');
const ProxyChain = require('proxy-chain');
require('dotenv').config();

const messageRoutes = require('./routes/messages');
const uiRoutes = require('./routes/ui');

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(limiter);
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Session Manager
// Simple WhatsApp client setup - like code sample
// Base client configuration (will be extended with proxy if needed)
function getBaseClientConfig() {
  return {
    // 1. Handle Session Storage
    authStrategy: new LocalAuth({
        dataPath: '/app/session_data'
    }),
    // 👇 ADD THIS LINE (0 = Infinite wait, Default is 60000ms)
    authTimeoutMs: 0, 

    // 👇 ADD THIS TOO (Give Puppeteer more time to attach)
    qrMaxRetries: 0, 


    // 2. Vital Options for Stability
    options: {
        // Setting a fixed userAgent is critical. It stops WA from identifying
        // the bot as "HeadlessChrome", which prevents forced refreshes/disconnects.
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36'
    },

    // 3. Puppeteer Config
    puppeteer: {
        headless: 'shell', // New headless mode - more stable, behaves like real browser
        protocolTimeout: 0, 
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // Critical for Docker memory
          '--disable-gpu',
          '--no-first-run',
          '--ignore-certificate-errors',
          
          // --- 2. PERFORMANCE & RESOURCE SAVING (From your list) ---
          '--disable-accelerated-2d-canvas',
          '--hide-scrollbars',
          '--disable-notifications',
          '--disable-extensions',
          '--mute-audio',
          '--disable-breakpad', // Disables crash reporting (saves RAM)
          
          // --- 3. PREVENT "STUCK" MESSAGES (From your list - VITAL) ---
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
        
        // --- 5. NETWORK OPTIMIZATIONS ---
        '--disable-features=TranslateUI,BlinkGenPropertyTrees,IsolateOrigins,site-per-process',
        '--enable-features=NetworkService,NetworkServiceInProcess'
        ],
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser'
    },
    // webVersionCache removed — the remote URL for 2.2412.54 is a 404.
    // Let whatsapp-web.js fetch the latest compatible version automatically.
  };
}

let client;
let messageCount = 0;
let clientCreatedAt = null;
let lastRestartReason = null;
let heartbeatInterval = null;

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

async function createClient() {
  console.log('🚀 Creating WhatsApp client...');
  messageCount = 0;
  clientCreatedAt = Date.now();
  const clientConfig = getBaseClientConfig();

  // Log the webVersionCache config for debugging
  if (clientConfig.webVersionCache) {
    console.log(`🔍 webVersionCache: type=${clientConfig.webVersionCache.type}, remotePath=${clientConfig.webVersionCache.remotePath}`);
  } else {
    console.log('🔍 webVersionCache: not set (using library default)');
  }

  // Handle proxy configuration with anonymization
  if (process.env.PROXY_SERVER) {
    console.log("🌐 Configuring proxy server");

    try {
      // Anonymize the proxy using ProxyChain
      const anonymizedProxy = await ProxyChain.anonymizeProxy(process.env.PROXY_SERVER);
      console.log(`🔐 Proxy anonymized: ${anonymizedProxy}`);

      // Add the anonymized proxy to puppeteer args
      clientConfig.puppeteer.args.push(`--proxy-server=${anonymizedProxy}`);
    } catch (error) {
      console.error("❌ Failed to anonymize proxy:", error);
      // Fallback to direct proxy if anonymization fails
      clientConfig.puppeteer.args.push(`--proxy-server=${process.env.PROXY_SERVER}`);
    }
  }

  client = new Client(clientConfig);
  attachClientHandlers(client);
  console.log('🔍 Calling client.initialize()...');
  client.initialize().catch(err => {
    console.error('❌ client.initialize() threw:', err.message);
    console.error(err.stack);
  });
  startWatchdog();
  startHeartbeat();
}

function guardPage(page) {
  console.log('🛡️ guardPage: Attaching page/browser error handlers');

  page.on('error', err => {
    console.error('🛡️ [LIFECYCLE] Puppeteer page crashed:', err.message);
    scheduleRestart('page_crash');
  });

  page.on('pageerror', err => {
    console.warn('🛡️ Page JS error (non-fatal):', err.message);
  });

  page.on('close', () => {
    console.warn('🛡️ [LIFECYCLE] Puppeteer page was closed unexpectedly');
    scheduleRestart('page_closed');
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.error('🛡️ Browser console error:', msg.text());
    }
  });

  const browser = page.browser();
  browser.on('disconnected', () => {
    console.warn('🛡️ [LIFECYCLE] Browser process disconnected');
    scheduleRestart('browser_disconnected');
  });

  // PRIMARY ZOMBIE FIX: Detect WhatsApp Web internal SPA navigations.
  // When WhatsApp Web navigates internally, the Puppeteer execution context
  // is destroyed and recreated. The library re-injects Store, but Node.js-side
  // message event listeners are silently dropped — causing the zombie state.
  // See: https://github.com/wwebjs/whatsapp-web.js/issues/127049
  const mainFrame = page.mainFrame();
  let initialNavigation = true;
  page.on('framenavigated', (frame) => {
    if (frame !== mainFrame) return; // Ignore iframe navigations
    if (initialNavigation) {
      initialNavigation = false;
      console.log(`🔄 [NAVIGATION] Ignoring initial frame navigation to ${frame.url()}`);
      return;
    }
    const url = frame.url();
    console.log(`🔄 [NAVIGATION] Main frame navigated to ${url} — triggering restart`);
    scheduleRestart('navigation');
  });
}

let watchdogInterval = null;

// Add this function
function startWatchdog() {
  if (watchdogInterval) clearInterval(watchdogInterval);

  watchdogInterval = setInterval(async () => {
      if (!clientReady || !client) return;

      // Create a timeout promise
      const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 10000)
      );

      try {
          // Try to evaluate a simple script in the browser
          // If the browser is "stuck", this will hang.
          // We race it against the timeout.
          await Promise.race([
              client.pupPage.evaluate(() => 1 + 1),
              timeout
          ]);
      } catch (error) {
          console.error('🚨 [WATCHDOG] Browser is unresponsive/stuck. Restarting...');
          scheduleRestart('watchdog_timeout');
      }
  }, 60000); // Check every 60 seconds
}

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

function attachClientHandlers(client) {
  const startTime = Date.now();
  const ts = () => `[+${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

  client.on('ready', () => {
    const pushname = client.info?.pushname || 'unknown';
    const wid = client.info?.wid?._serialized || 'unknown';
    console.log(`${ts()} ✅ [LIFECYCLE] WhatsApp client is ready — user=${pushname} wid=${wid} lastRestart=${lastRestartReason || 'initial'}`);
    clientReady = true;
    const page = client.pupPage;
    guardPage(page);
    startGroupPurge(client);
  });

  client.on('disconnected', reason => {
    console.warn(`${ts()} ⚠️ [LIFECYCLE] Client disconnected: ${reason}`);
    clientReady = false;
    scheduleRestart('client_disconnected');
  });

  client.on('auth_failure', msg => {
    console.error(`${ts()} ❌ Authentication failed: ${msg}`);
  });

  client.on('loading_screen', (percent, message) => {
    console.log(`${ts()} ⏳ Loading screen: ${percent}% ${message}`);
  });

  client.on('change_state', state => {
    console.log(`${ts()} 🔄 [STATE] Client state changed: ${state}`);
    if (state === 'CONFLICT' || state === 'UNLAUNCHED' || state === 'TIMEOUT') {
      console.warn(`${ts()} ⚠️ [STATE] Problematic state detected: ${state}`);
    }
  });

  client.on('qr', (qr) => {
    console.log(`${ts()} 📱 QR Code received! Scan with WhatsApp:`);
    qrcodeTerminal.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    console.log(`${ts()} 🔐 Authenticated successfully!`);
    console.log(`${ts()} 🔍 Waiting for ready event... (if this hangs, the WA Web page failed to load)`);
  });


  function startGroupPurge(client) {
    // SECURITY CHECK: Default to FALSE if variable is missing
    const isPurgeEnabled = process.env.ENABLE_GROUP_PURGE === 'true';
    const purgeIntervalMinutes = parseInt(process.env.PURGE_INTERVAL_MINUTES || '1440 ');

    if (!isPurgeEnabled) {
        console.log('🛡️ Auto-Purge System: DISABLED (Safety Default). Group history will be saved.');
        return; 
    }

    console.log(`⚠️ Auto-Purge System: ENABLED. Clearing GROUP history every ${purgeIntervalMinutes} minutes.`);
    console.log('   (To disable this, remove ENABLE_GROUP_PURGE from your env)');

    const intervalMs = purgeIntervalMinutes * 60 * 1000;

    setInterval(async () => {
        // Double check client state
        if (!clientReady || !client) return;
        
        console.log('🧹 Purge: Running scheduled cleanup on groups...');
        
        try {
            const chats = await client.getChats();
            let clearedCount = 0;

            for (const chat of chats) {
                // Strict Filter: Groups Only
                if (chat.isGroup) {
                    try {
                        await chat.clearMessages();
                        clearedCount++;
                        // Tiny throttle to prevent CPU spike
                        await new Promise(r => setTimeout(r, 200)); 
                    } catch (e) {
                        // Silently fail for individual chats to keep loop going
                    }
                }
            }
            
            if (clearedCount > 0) {
                console.log(`✨ Purge: Cleared history from ${clearedCount} groups.`);
            }
            
        } catch (error) {
            console.error('❌ Purge Error:', error.message);
        }
    }, intervalMs); 
}


  // Conditionally register message event handler based on environment variable
  const handleMessages = process.env.HANDLE_MESSAGES !== 'false';
  if (handleMessages) {
      console.log('✅ Message handling enabled');
      // Message events for debugging - only received messages
      client.on('message', async (msg) => {
          messageCount++;
          // console.log('📨 Message received - ALL FIELDS:', JSON.stringify(msg, null, 2));
          console.log('📨 Message received:', {
              body: msg.body,
              from: msg.from,
              to: msg.to,
              isGroup: msg.from.includes('@g.us'),
              hasQuotedMsg: !!msg.hasQuotedMsg,
              timestamp: new Date().toISOString()
          });
          // Get allowed groups from environment variable (comma-separated list)
          const allowedGroups = process.env.ALLOWED_GROUPS ? process.env.ALLOWED_GROUPS.split(',').map(id => id.trim()) : ['120363406850649153@g.us'];
          console.log('🔧 Allowed groups:', allowedGroups);
          
          const isGroup = msg.from.includes('@g.us');
          const allowPrivateMessages = process.env.ALLOW_PRIVATE_MESSAGES === 'true';
          
          // Check if we should process private messages
          if (!isGroup && !allowPrivateMessages) {
              console.log('🚫 Private message filtered - private messages not enabled');
              return;
          }
          
          // If it's a group message, check if it's in the allowed groups list
          if (isGroup) {
              const groupId = msg.from;
              if (!allowedGroups.includes(groupId)) {
                  console.log(`🚫 Message from group ${groupId} filtered - not in allowed groups list`);
                  return;
              }
              console.log(`✅ Message from allowed group: ${groupId}`);
          } else {
              console.log(`✅ Private message from: ${msg.from}`);
          }
          
          const botPhoneNumber = process.env.BOT_PHONE_NUMBER;
          if (!botPhoneNumber) {
              console.error('❌ BOT_PHONE_NUMBER environment variable not set');
              return;
          }
          
          const webhookApiKey = process.env.WHATSAPP_API_KEY;
          if (!webhookApiKey) {
              console.error('❌ WHATSAPP_API_KEY environment variable not set');
              return;
          }

          if (msg.to === botPhoneNumber) {
              // Filter: Only forward messages containing Hebrew keywords חפש or מצא
              // if (!msg.body.includes('חפש') && !msg.body.includes('מצא')) {
              //     console.log('🚫 Message filtered - does not contain required Hebrew keywords');
              //     return;
              // }
              
              try {
                  const webhookPayload = {
                      message_id: msg.id._serialized,
                      chat_id: msg.from,
                      replied_message_id: msg.hasQuotedMsg ? msg._data.quotedStanzaID || null : null,
                      is_group: msg.from.includes('@g.us'),
                      message_text: msg.body
                  };
                  
                  console.log('🔄 Forwarding to webhook v2:', webhookPayload);
                  
                  const webhookUrl = process.env.WHATSAPP_BOT_URL || 'http://localhost:8000/whatsapp/v2/webhook';
                  const response = await fetch(webhookUrl, {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                          'X-API-Key': webhookApiKey
                      },
                      body: JSON.stringify(webhookPayload)
                  });
                  
                  if (response.ok) {
                      console.log('✅ Webhook v2 call successful');
                  } else {
                      console.error('❌ Webhook v2 call failed:', response.status, response.statusText);
                  }
              } catch (error) {
                  console.error('❌ Error calling webhook v2:', error);
              }
          }
      });
  } else {
      console.log('🚫 Message handling disabled - no event handlers registered');
  }

  }


let restartTimer = null;

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

let clientReady = false;


async function protectNavigation(page) {
  // Ensure interception is enabled
  await page.setRequestInterception(true);

  page.on('request', req => {
    // CRITICAL FIX: Stop if the request was already handled by whatsapp-web.js
    if (req.isInterceptResolutionHandled()) return;

    const url = req.url();

    if (req.isNavigationRequest() && !url.startsWith('https://web.whatsapp.com')) {
      console.warn('Blocked navigation to:', url);
      return req.abort();
    }
    
    // Only continue if we haven't aborted above
    req.continue();
  });
}

// Make client available to routes
app.use((req, res, next) => {
  req.client = client;
  req.clientReady = clientReady;
  next();
});

// Import authentication middleware
const authenticateAPI = (req, res, next) => {
    console.log(`[AUTH] Checking API key for ${req.method} ${req.path}`);
    const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY;
    const providedKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!providedKey || providedKey !== WHATSAPP_API_KEY) {
        console.log(`[AUTH] Failed - Provided: ${providedKey}`);
        return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Valid API key required' 
        });
    }
    
    console.log(`[AUTH] Success - API key validated`);
    next();
};

// Routes
app.use('/api', messageRoutes);
app.use('/ui', uiRoutes);

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

// WhatsApp connection status endpoint (protected)
app.get('/whatsapp-status', authenticateAPI, (req, res) => {
  const status = {
    connected: clientReady,
    timestamp: new Date().toISOString(),
    client_info: clientReady && client.info ? {
      pushname: client.info.pushname,
      me: client.info.me
    } : null
  };
  
  res.json(status);
});

// Debug endpoint to trigger message handler (protected)
app.post('/debug/trigger-message', authenticateAPI, (req, res) => {
  try {
    const mockMessage = {
      id: {
        id: `DEBUG_${Date.now()}`
      },
      body: req.body.message || 'Debug test message',
      from: req.body.from || '120363403302220749@g.us', // Default to allowed group
      to: req.body.to || 'debug@c.us',
      hasQuotedMsg: req.body.hasQuotedMsg || false,
      _data: {
        quotedStanzaID: req.body.quotedStanzaID || null
      },
      timestamp: Date.now()
    };
    
    console.log('🧪 Triggering debug message event:', mockMessage);
    client.emit('message', mockMessage);
    
    res.json({ 
      success: true, 
      message: 'Message event triggered',
      mockMessage: mockMessage
    });
  } catch (error) {
    console.error('❌ Error triggering debug message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Hi there',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: true,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('\nReceived shutdown signal, gracefully closing WhatsApp sessions...');
  // Stop all intervals to prevent watchdog/heartbeat from firing during shutdown
  if (watchdogInterval) clearInterval(watchdogInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  try {
    // Close WhatsApp client properly
    if (client && clientReady) {
      console.log('🔌 Closing WhatsApp client...');
      await client.destroy();
    }
    
    // Give Chrome time to close properly
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('✅ All sessions closed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Initialize client and start server
createClient();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp API Server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log(`Max sessions allowed: ${process.env.MAX_SESSIONS || 'unlimited'}`);
});