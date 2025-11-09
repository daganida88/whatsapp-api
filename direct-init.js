const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// Session directory setup (copied from whatsapp-service)
let SESSION_DATA_PATH = process.env.SESSION_DATA_PATH;
if (!SESSION_DATA_PATH) {
    // Auto-detect environment: if /app directory exists, we're likely in Docker
    const isDockerEnvironment = fs.existsSync('/app') && process.cwd().startsWith('/app');
    SESSION_DATA_PATH = isDockerEnvironment ? '/app/.wwebjs_auth' : './session_data';
}
console.log(`📁 Session data path: ${SESSION_DATA_PATH}`);

// Ensure session directory exists
if (!fs.existsSync(SESSION_DATA_PATH)) {
    console.log('📁 Creating session directory:', SESSION_DATA_PATH);
    fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
}

// Chrome arguments (copied from whatsapp-service)
const chromeArgs = [
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
    '--memory-pressure-off'
];

// Client configuration (copied from whatsapp-service)
const clientConfig = {
    authStrategy: new LocalAuth({
        clientId: "whatsapp-api-persistent",
        dataPath: SESSION_DATA_PATH
    }),
    puppeteer: {
        headless: process.env.NODE_ENV === 'development' ? false : true,
        args: chromeArgs,
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser'
    }
};

// Create client (copied from whatsapp-service)
console.log('🚀 Initializing WhatsApp client...');
const client = new Client(clientConfig);

// QR Code event (copied from whatsapp-service)
client.on('qr', (qr) => {
    console.log('📱 QR Code received! Please scan with your WhatsApp mobile app:');
    qrcode.generate(qr, { small: true });
    console.log('⏳ Waiting for QR code scan...');
});

// Ready event (copied from whatsapp-service)
client.on('ready', () => {
    console.log('✅ WhatsApp Web client is ready!');
    console.log('🎯 Client is authenticated and ready to send messages');
    
    // Test message
    testMessage();
});

// Loading screen event
client.on('loading_screen', (percent, message) => {
    console.log('⏳ Loading screen:', percent, message);
});

// State change event
client.on('change_state', state => {
    console.log('🔄 State changed:', state);
});

// Authentication success
client.on('authenticated', () => {
    console.log('🔐 Client authenticated successfully!');
});

// Authentication failure
client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

// Disconnection event
client.on('disconnected', (reason) => {
    console.log('🔌 Client disconnected:', reason);
});

async function testMessage() {
    try {
        console.log('💬 Sending test message...');
        const result = await client.sendMessage('120363403302220749@g.us', 'Hello from direct initialization! 🚀');
        console.log('✅ Message sent:', result.id._serialized);
    } catch (error) {
        console.error('❌ Message error:', error.message);
    }
}

// Initialize the client
client.initialize();

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down...');
    await client.destroy();
    process.exit(0);
});