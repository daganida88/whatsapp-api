const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const fetch = require('node-fetch');
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
const clientConfig = {
    authStrategy: new LocalAuth({
        dataPath: '/app/session_data'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--user-data-dir=/app/session_data/session',
        ],
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser'
    }
};

if (process.env.PROXY_SERVER) {
    console.log("🌐 Configuring proxy server");
    
    // Check if proxy URL already contains authentication (like http://user:pass@host:port)
    const hasEmbeddedAuth = process.env.PROXY_SERVER.includes('@');
    
    if (hasEmbeddedAuth) {
        // Use proxy URL with embedded authentication
        console.log('🔐 Using embedded proxy authentication');
        clientConfig.puppeteer.args.push(`--proxy-server=${process.env.PROXY_SERVER}`);
    }
}

const client = new Client(clientConfig);

let clientReady = false;

// QR Code event
client.on('qr', (qr) => {
    console.log('📱 QR Code received! Scan with WhatsApp:');
    qrcodeTerminal.generate(qr, { small: true });
});

// Ready event
client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    console.log('📱 Connected as:', client.info.pushname);
    clientReady = true;
});

// Authentication success
client.on('authenticated', () => {
    console.log('🔐 Authenticated successfully!');
});

// Authentication failure
client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
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


client.on('group_join', (notification) => {
    console.log('👥 Group join:', notification);
});

client.on('group_leave', (notification) => {
    console.log('👥 Group leave:', notification);
});

// Disconnect handler with auto-reconnect
client.on('disconnected', (reason) => {
    console.log('🔌 Client disconnected:', reason);
    clientReady = false;
    
    // Auto-reconnect after 5 seconds
    console.log('🔄 Attempting to reconnect in 5 seconds...');
    setTimeout(() => {
        console.log('🚀 Reinitializing WhatsApp client...');
        client.initialize().catch(err => {
            console.error('❌ Reconnection failed:', err);
        });
    }, 5000);
});

// Loading screen handler
client.on('loading_screen', (percent, message) => {
    console.log('⏳ Loading screen:', percent + '%', message);
});

// State change handler
client.on('change_state', state => {
    console.log('🔄 Client state changed:', state);
});

// Initialize the client
console.log('🚀 Initializing WhatsApp client...');
client.initialize();

// Make client available to routes
app.use((req, res, next) => {
  req.client = client;
  req.clientReady = clientReady;
  next();
});

// Routes
app.use('/api', messageRoutes);
app.use('/ui', uiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// WhatsApp connection status endpoint
app.get('/whatsapp-status', (req, res) => {
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

// Debug endpoint to trigger message handler
app.post('/debug/trigger-message', (req, res) => {
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

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`WhatsApp API Server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log(`Max sessions allowed: ${process.env.MAX_SESSIONS || 'unlimited'}`);
});