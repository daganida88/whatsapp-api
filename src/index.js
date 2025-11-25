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

    // 2. Vital Options for Stability
    options: {
        // Setting a fixed userAgent is critical. It stops WA from identifying
        // the bot as "HeadlessChrome", which prevents forced refreshes/disconnects.
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36'
    },

    // 3. Puppeteer Config
    puppeteer: {
        headless: true, // Try 'new' if you are on Puppeteer v19+, otherwise true
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Fixes the Docker memory crash
            '--disable-gpu',
            '--no-first-run',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-web-security',
            '--disable-features=TranslateUI,VizDisplayCompositor',

            // --- CRITICAL FIX HERE ---
            // I removed '--user-data-dir=/app/session_data/session'
            // because LocalAuth above is already doing this.
            // Having both causes the crash/CPU loop.
        ],
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser'
    },

    // 4. Web Version
    // I have commented this out. Using a hardcoded version is the #1 cause
    // of "Context Destroyed" loops when WhatsApp updates their server.
    // Let the library fetch the latest compatible version automatically.
    /*
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
    */
  };
}

let client;

async function createClient() {
  const clientConfig = getBaseClientConfig();

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
  client.initialize();
}

function guardPage(page) {
  page.on('error', err => {
    console.error('Puppeteer page error:', err);
    scheduleRestart();
  });

  page.on('pageerror', err => {
    console.error('Page JS error:', err);
    // usually not fatal, but you can log it
  });

  page.on('close', () => {
    console.warn('Puppeteer page was closed');
    scheduleRestart();
  });

  const browser = page.browser();
  browser.on('disconnected', () => {
    console.warn('Browser disconnected');
    scheduleRestart();
  });
}


function attachClientHandlers(client) {
  client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    clientReady = true;
    const page = client.pupPage;
    guardPage(page);
    protectNavigation(page);
      
  });

  client.on('disconnected', reason => {
    console.warn('Client disconnected:', reason);
    clientReady = false;
    // if reason is 'LOGOUT', you'll likely need a new QR
    // but for crashes, just restart
    scheduleRestart();
  });

  client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
    // don't auto-delete auth here unless you really want a fresh QR
  });

  // Loading screen handler
  client.on('loading_screen', (percent, message) => {
    console.log('⏳ Loading screen:', percent + '%', message);
  });

  // State change handler
  client.on('change_state', state => {
    console.log('🔄 Client state changed:', state);
  });

  // QR Code event
  client.on('qr', (qr) => {
    console.log('📱 QR Code received! Scan with WhatsApp:');
    qrcodeTerminal.generate(qr, { small: true });
  });

  // Authentication success
  client.on('authenticated', () => {
    console.log('🔐 Authenticated successfully!');
  });


  // Conditionally register message event handler based on environment variable
  const handleMessages = process.env.HANDLE_MESSAGES !== 'false';
  if (handleMessages) {
      console.log('✅ Message handling enabled');
      // Message events for debugging - only received messages
      client.on('message', async (msg) => {
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

function scheduleRestart() {
  if (restartTimer) return;
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      await client.destroy().catch(() => {});
    } catch (_) {}
    createClient();
  }, 2000);
}

let clientReady = false;


async function protectNavigation(page) {
  await page.setRequestInterception(true);

  page.on('request', req => {
    const url = req.url();

    if (req.isNavigationRequest() && !url.startsWith('https://web.whatsapp.com')) {
      console.warn('Blocked navigation to:', url);
      return req.abort();
    }
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

// Health check endpoint (protected)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
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