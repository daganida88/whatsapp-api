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
            '--profile-directory=Default'
        ],
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser'
    }
};

if (process.env.PROXY_SERVER && process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD) {
    clientConfig.proxyAuthentication = { 
        username: process.env.PROXY_USERNAME, 
        password: process.env.PROXY_PASSWORD 
    };
    clientConfig.puppeteer.args.push(`--proxy-server=${process.env.PROXY_SERVER}`);
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
    
    // Forward messages to/from bot phone number to webhook
    const botPhoneNumber = process.env.BOT_PHONE_NUMBER;
    if (!botPhoneNumber) {
        console.error('❌ BOT_PHONE_NUMBER environment variable not set');
        return;
    }
    
    const webhookApiKey = process.env.WEBHOOK_API_KEY;
    if (!webhookApiKey) {
        console.error('❌ WEBHOOK_API_KEY environment variable not set');
        return;
    }
    
    if (msg.to === botPhoneNumber || msg.from === botPhoneNumber) {
        try {
            const webhookPayload = {
                message_id: msg.id.id,
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

client.on('group_join', (notification) => {
    console.log('👥 Group join:', notification);
});

client.on('group_leave', (notification) => {
    console.log('👥 Group leave:', notification);
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