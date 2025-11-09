const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

// Simple client setup - exactly like the code sample
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './session_data'
    })
});

// QR Code event
client.on('qr', (qr) => {
    console.log('📱 QR Code received! Scan with WhatsApp:');
    qrcode.generate(qr, { small: true });
});

// Ready event
client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
    console.log('📱 Connected as:', client.info.pushname);
});

// Authentication success
client.on('authenticated', () => {
    console.log('🔐 Authenticated successfully!');
});

// Authentication failure
client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

// Message received
client.on('message', async (msg) => {
    console.log('📨 Message received:', msg.body);
});

// Initialize the client
console.log('🚀 Initializing WhatsApp client...');
client.initialize();

// Simple Express server for API
const app = express();
app.use(express.json());

// Send message endpoint
app.post('/send', async (req, res) => {
    try {
        const { to, message } = req.body;
        const result = await client.sendMessage(to, message);
        res.json({ success: true, messageId: result.id._serialized });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Forward message endpoint  
app.post('/forward', async (req, res) => {
    try {
        const { messageId, to } = req.body;
        const message = await client.getMessageById(messageId);
        await message.forward(to);
        res.json({ success: true, message: 'Message forwarded' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get chats endpoint
app.get('/chats', async (req, res) => {
    try {
        const chats = await client.getChats();
        const formattedChats = chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name || 'No Name',
            isGroup: chat.isGroup
        }));
        res.json({ chats: formattedChats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
const PORT = 3002;
app.listen(PORT, () => {
    console.log(`🚀 API server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down...');
    await client.destroy();
    process.exit(0);
});