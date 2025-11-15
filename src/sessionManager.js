const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.qrCodes = new Map();
    this.maxSessions = parseInt(process.env.MAX_SESSIONS) || 10;
    this.sessionTimeout = parseInt(process.env.SESSION_TIMEOUT) || 300000; // 5 minutes default
    
    // Ensure session directory exists
    this.ensureSessionDirectory();
    
    // Auto-restore existing sessions on startup
    this.restoreExistingSessions();
  }

  ensureSessionDirectory() {
    const fs = require('fs');
    const authPath = '/app/.wwebjs_auth';
    
    try {
      if (!fs.existsSync(authPath)) {
        console.log('📁 Creating session directory:', authPath);
        fs.mkdirSync(authPath, { recursive: true });
      }
      console.log('📁 Session data path:', authPath);
    } catch (error) {
      console.error('⚠️  Could not create session directory:', error);
    }
  }

  async createSession(clientId, skipExistingCheck = false) {
    if (!skipExistingCheck && this.sessions.has(clientId)) {
      throw new Error(`Session ${clientId} already exists`);
    }

    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Maximum sessions limit (${this.maxSessions}) reached`);
    }

    // Session directory setup (copied from whatsapp-service)
    const fs = require('fs');
    let SESSION_DATA_PATH = process.env.SESSION_DATA_PATH;
    if (!SESSION_DATA_PATH) {
      const isDockerEnvironment = fs.existsSync('/app') && process.cwd().startsWith('/app');
      SESSION_DATA_PATH = isDockerEnvironment ? '/app/.wwebjs_auth' : './session_data';
    }

    // Ensure session directory exists (copied from whatsapp-service)
    try {
      if (!fs.existsSync(SESSION_DATA_PATH)) {
        console.log('📁 Creating session directory:', SESSION_DATA_PATH);
        fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
      }
    } catch (error) {
      console.warn('⚠️  Could not create session directory at:', SESSION_DATA_PATH);
      console.log('📁 Falling back to local session directory: ./session_data');
      SESSION_DATA_PATH = './session_data';
      fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: clientId,
        dataPath: SESSION_DATA_PATH
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
          `--user-data-dir=/tmp/chrome-user-data-${clientId}`
        ],
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser'
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
      }
    });

    // Setup event listeners
    client.on('qr', async (qr) => {
      console.log(`\n=== QR Code for session: ${clientId} ===`);
      console.log('Scan this QR code with WhatsApp on your phone:');
      console.log('WhatsApp → Linked Devices → Link a Device\n');
      
      // Display QR code in terminal
      qrcodeTerminal.generate(qr, { small: true });
      
      console.log(`\n=== End QR Code for session: ${clientId} ===\n`);
      
      try {
        const qrImage = await qrcode.toDataURL(qr);
        this.qrCodes.set(clientId, {
          qr: qr,
          qrImage: qrImage,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error(`Failed to generate QR code for ${clientId}:`, error);
      }
    });

    client.on('ready', () => {
      console.log(`WhatsApp client ${clientId} is ready!`);
      this.qrCodes.delete(clientId);
    });

    client.on('authenticated', (session) => {
      console.log(`Session ${clientId} authenticated successfully`);
      this.qrCodes.delete(clientId);
    });

    client.on('auth_failure', (msg) => {
      console.error(`Authentication failed for session ${clientId}:`, msg);
      this.qrCodes.delete(clientId);
    });

    client.on('disconnected', (reason) => {
      console.log(`Session ${clientId} disconnected:`, reason);
      this.sessions.delete(clientId);
      this.qrCodes.delete(clientId);
    });

    client.on('message', async (message) => {
      // Check if message handling is enabled (default: true)
      const handleMessages = process.env.HANDLE_MESSAGES !== 'false';
      if (!handleMessages) {
        console.log(`🚫 Message handling disabled for session ${clientId} - dropping message`);
        return;
      }
      
      console.log(`Message received in session ${clientId}: ${message.body}`);
    });

    // Store session info
    this.sessions.set(clientId, {
      client: client,
      status: 'initializing',
      createdAt: Date.now(),
      lastActivity: Date.now()
    });

    try {
      await client.initialize();
      this.sessions.get(clientId).status = 'initialized';
      return { success: true, message: `Session ${clientId} initialized successfully` };
    } catch (error) {
      this.sessions.delete(clientId);
      throw new Error(`Failed to initialize session ${clientId}: ${error.message}`);
    }
  }

  getSession(clientId) {
    const session = this.sessions.get(clientId);
    if (!session) {
      throw new Error(`Session ${clientId} not found`);
    }
    
    // Update last activity
    session.lastActivity = Date.now();
    return session;
  }

  getClient(clientId) {
    const session = this.getSession(clientId);
    return session.client;
  }

  getQRCode(clientId) {
    const qrData = this.qrCodes.get(clientId);
    if (!qrData) {
      throw new Error(`No QR code available for session ${clientId}. Make sure the session is initializing.`);
    }
    return qrData;
  }

  getSessionStatus(clientId) {
    const session = this.sessions.get(clientId);
    if (!session) {
      return { exists: false };
    }

    const isReady = session.client.info ? true : false;
    const qrCode = this.qrCodes.get(clientId);

    return {
      exists: true,
      status: session.status,
      ready: isReady,
      hasQR: !!qrCode,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      info: session.client.info || null
    };
  }

  getSessionsStatus() {
    const sessions = {};
    for (const [clientId, session] of this.sessions) {
      sessions[clientId] = this.getSessionStatus(clientId);
    }
    return {
      count: this.sessions.size,
      maxSessions: this.maxSessions,
      sessions: sessions
    };
  }

  async destroySession(clientId) {
    const session = this.sessions.get(clientId);
    if (!session) {
      throw new Error(`Session ${clientId} not found`);
    }

    try {
      await session.client.logout();
      await session.client.destroy();
    } catch (error) {
      console.warn(`Error destroying session ${clientId}:`, error.message);
    }

    this.sessions.delete(clientId);
    this.qrCodes.delete(clientId);
    
    console.log(`Session ${clientId} destroyed successfully`);
    return { success: true, message: `Session ${clientId} destroyed` };
  }

  async destroyAllSessions() {
    const promises = [];
    for (const [clientId] of this.sessions) {
      promises.push(this.destroySession(clientId).catch(err => 
        console.error(`Error destroying session ${clientId}:`, err)
      ));
    }
    
    await Promise.allSettled(promises);
    this.sessions.clear();
    this.qrCodes.clear();
  }

  async sendMessage(clientId, phoneNumber, message, options = {}) {
    const client = this.getClient(clientId);
    
    if (!client.info) {
      throw new Error(`Session ${clientId} is not ready`);
    }

    // Format phone number
    const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
    
    try {
      const result = await client.sendMessage(chatId, message, options);
      this.getSession(clientId).lastActivity = Date.now();
      return result;
    } catch (error) {
      console.error(`Error sending message in session ${clientId}:`, error);
      throw error;
    }
  }

  async sendMedia(clientId, phoneNumber, media, options = {}) {
    const client = this.getClient(clientId);
    
    if (!client.info) {
      throw new Error(`Session ${clientId} is not ready`);
    }

    // Format phone number
    const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
    
    try {
      const result = await client.sendMessage(chatId, media, options);
      this.getSession(clientId).lastActivity = Date.now();
      return result;
    } catch (error) {
      console.error(`Error sending media in session ${clientId}:`, error);
      throw error;
    }
  }

  // Auto-restore sessions that have saved authentication
  async restoreExistingSessions() {
    const fs = require('fs');
    const path = require('path');
    
    try {
      const authPath = '/app/.wwebjs_auth';
      if (!fs.existsSync(authPath)) {
        console.log('No existing session data found');
        return;
      }
      
      const sessionDirs = fs.readdirSync(authPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('session-'))
        .map(dirent => dirent.name);
      
      for (const sessionDir of sessionDirs) {
        const clientId = sessionDir.replace('session-', '');
        console.log(`Restoring session: ${clientId}`);
        
        try {
          await this.createSession(clientId, true); // Skip existing check for restoration
        } catch (error) {
          console.error(`Failed to restore session ${clientId}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Error during session restoration:', error);
    }
  }

  // Cleanup inactive sessions
  cleanupInactiveSessions() {
    const now = Date.now();
    for (const [clientId, session] of this.sessions) {
      if (now - session.lastActivity > this.sessionTimeout) {
        console.log(`Cleaning up inactive session: ${clientId}`);
        this.destroySession(clientId).catch(err => 
          console.error(`Error cleaning up session ${clientId}:`, err)
        );
      }
    }
  }
}

module.exports = SessionManager;