const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const { MessageMedia } = require('whatsapp-web.js');

const router = express.Router();

// API Key from environment
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY;

// Helper function to race a promise
const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
          reject(new Error(`Operation timed out after ${ms}ms`));
      }, ms);
  });

  return Promise.race([
      promise,
      timeoutPromise
  ]).finally(() => clearTimeout(timeoutId));
};


// Authentication middleware
const authenticateAPI = (req, res, next) => {
    console.log(`[AUTH] Checking API key for ${req.method} ${req.path}`);
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

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 64 * 1024 * 1024, // 64MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|avi|mov|pdf|doc|docx|xls|xlsx|ppt|pptx/;
    const extname = allowedTypes.test(file.originalname.toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Validation schemas
const phoneSchema = Joi.string()
  .required();

const clientIdSchema = Joi.string()
  .alphanum()
  .min(1)
  .max(50)
  .required()
  .messages({
    'string.alphanum': 'Client ID must contain only alphanumeric characters'
  });

const textMessageSchema = Joi.object({
  phone: phoneSchema,
  message: Joi.string().min(1).max(4096).required(),
  message_id_to_reply: Joi.string().optional() // Full serialized message ID (e.g., "false_chat@g.us_3EB007BBE25141001CDC")
});

const mediaMessageSchema = Joi.object({
  phone: phoneSchema,
  media: Joi.string().required(),
  base64Data: Joi.string().optional(),
  mimeType: Joi.string().optional(),
  caption: Joi.string().min(1).max(4096).optional(),
  message_id_to_reply: Joi.string().allow(null).optional() // Full serialized message ID (e.g., "false_chat@g.us_3EB007BBE25141001CDC")
});

// Middleware to validate request body
const validateBody = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      console.log(`[VALIDATION] Failed:`, error.details);
      return res.status(400).json({
        error: true,
        message: 'Validation error',
        details: error.details.map(d => d.message),
        requestBody: req.body,
        timestamp: new Date().toISOString()
      });
    }
    console.log(`[VALIDATION] Success - Request body validated`);
    next();
  };
};

// Middleware to validate client session
const validateSession = async (req, res, next) => {
  try {
    console.log(`[SESSION] Validating client session`);
    const client = req.client;
    const clientReady = req.clientReady;
    
    console.log(`[SESSION] Client ready: ${clientReady}, Has info: ${!!client?.info}`);
    
    // Use same logic as /api/sessions endpoint
    const isReady = clientReady && client.info ? true : false;
    
    if (!client || !isReady) {
      console.log(`[SESSION] Validation failed - Client not ready`);
      return res.status(400).json({
        error: true,
        message: 'Client is not ready',
        clientReady: clientReady,
        hasInfo: !!client.info,
        timestamp: new Date().toISOString()
      });
    }
    
    console.log(`[SESSION] Success - Client is ready`);
    next();
  } catch (error) {
    console.error(`[SESSION] Error validating session:`, error);
    res.status(500).json({
      error: true,
      message: 'Error validating session',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Session Management Routes

// Initialize a new session (single client - always ready)
router.post('/sessions/:clientId/initialize', authenticateAPI, async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Single client session is already initialized',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[SESSION-INIT] Error:`, error);
    res.status(400).json({
      error: true,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get QR code for session (not applicable for single client)
router.get('/sessions/:clientId/qr', (req, res) => {
  try {
    res.status(400).json({
      error: true,
      message: 'QR code not available - client should already be authenticated',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[SESSION-QR] Error:`, error);
    res.status(404).json({
      error: true,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get session status
router.get('/sessions/:clientId/status', (req, res) => {
  try {
    const client = req.client;
    const clientReady = req.clientReady;

    const sessionInfo = {
      exists: true,
      ready: clientReady && client.info ? true : false,
      info: client.info || null,
      status: clientReady ? 'ready' : 'initializing'
    };

    res.json({
      success: true,
      ...sessionInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[SESSION-STATUS] Error:`, error);
    res.status(500).json({
      error: true,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Logout and destroy session (not recommended for single client)
router.post('/sessions/:clientId/logout', authenticateAPI, async (req, res) => {
  try {
    res.status(400).json({
      error: true,
      message: 'Cannot logout single client session - restart the application instead',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[SESSION-LOGOUT] Error:`, error);
    res.status(404).json({
      error: true,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get all sessions status (simple client version)
router.get('/sessions', (req, res) => {
  try {
    const client = req.client;
    const clientReady = req.clientReady;

    const sessionInfo = {
      exists: true,
      ready: clientReady && client.info ? true : false,
      info: client.info || null,
      status: clientReady ? 'ready' : 'initializing'
    };

    res.json({
      success: true,
      count: 1,
      maxSessions: 1,
      sessions: {
        'main': sessionInfo
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[SESSIONS] Error:`, error);
    res.status(500).json({
      error: true,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get groups for a session (only groups, not individual chats)
router.get('/sessions/:clientId/chats', async (req, res) => {
  try {
    console.log(`[CHATS] Loading groups for session: ${req.params.clientId}`);
    const { clientId } = req.params;
    const client = req.client;
    const clientReady = req.clientReady;

    if (!client || !clientReady || !client.info) {
      console.log(`[CHATS] Client is not ready`);
      return res.status(400).json({
        error: true,
        message: `Client is not ready`,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[CHATS] Getting chats...`);

    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('getChats() timeout after 30 seconds')), 30000);
    });

    const chats = await Promise.race([
      client.getChats(),
      timeoutPromise
    ]);

    console.log(`[CHATS] Retrieved ${chats.length} chats`);

    // Filter only groups
    const groups = chats.filter(chat => chat.isGroup);

    const formattedGroups = groups.map(chat => ({
      id: chat.id._serialized,
      name: chat.name || 'No Name',
      isGroup: true,
      participants: chat.participants?.length || 0,
      lastMessage: chat.lastMessage?.body?.substring(0, 50) || 'No messages',
      timestamp: chat.timestamp
    }));

    console.log(`[CHATS] Returning ${formattedGroups.length} groups`);

    res.json({
      success: true,
      chats: formattedGroups,
      groups: formattedGroups,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[CHATS] Error loading chats:`, error);
    res.status(500).json({
      error: true,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Message Routes

// Send text message
router.post('/send-text', authenticateAPI, validateBody(textMessageSchema), validateSession, async (req, res) => {
  try {
    const { phone, message, message_id_to_reply } = req.body;
    const client = req.client;

    console.log(`[SEND-TEXT] Request - Phone: ${phone}, ReplyTo: ${message_id_to_reply || 'none'}`);

    // Format phone number
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`;
    console.log(`[SEND-TEXT] Formatted chatId: ${chatId}`);
    
    let result;
    
    if (message_id_to_reply) {
      // Get the message to reply to and use reply method
      const messageToReply = await client.getMessageById(message_id_to_reply);
      result = await messageToReply.reply(message, undefined, { sendSeen: false });
    } else {
      // Send regular message
      result = await client.sendMessage(chatId, message, { sendSeen: false });
    }
    
    res.json({
      success: true,
      messageId: result.id._serialized,
      timestamp: new Date().toISOString(),
      data: {
        phone,
        message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
        replyTo: message_id_to_reply || null
      }
    });
  } catch (error) {
    console.error(`[SEND-TEXT] Error:`, error);
    res.status(500).json({
      error: true,
      message: 'Failed to send text message',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});


router.post('/send-media', authenticateAPI, validateBody(mediaMessageSchema), validateSession, async (req, res) => {
  try {
    console.log(`[SEND-MEDIA] Starting send media request`);
    const { phone, media, caption, message_id_to_reply } = req.body;
    const client = req.client;
        
    if (!media) {
      return res.status(400).json({ error: true, message: 'Media URL/path required' });
    }
    
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`;
    
    let mediaObj;

    // 1. TIMEOUT FOR DOWNLOADING MEDIA (30 Seconds Max)
    try {
        if (media.startsWith('http')) {
          console.log(`[SEND-MEDIA] Fetching media from URL...`);
          // Wrap the download in a timeout
          mediaObj = await withTimeout(
            MessageMedia.fromUrl(media, { unsafeMime: true }), 
            30000, 
            "Download Media"
          );
        } else if (media.startsWith('data:') || req.body.base64Data) {
          let mimeType = req.body.mimeType || 'image/jpeg';
          let base64Data = req.body.base64Data;

          // Extract MIME type and base64 data from data URL if provided
          if (media.startsWith('data:')) {
            // Parse data URL: "data:image/jpeg;base64,/9j/4AAQ..."
            const matches = media.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              mimeType = matches[1];  // e.g., "image/jpeg" or "video/mp4"
              base64Data = matches[2];
            } else {
              // Fallback: just split by comma
              base64Data = media.split(',')[1];
            }
          }

          console.log(`[SEND-MEDIA] Using base64 data with MIME type: ${mimeType}`);
          mediaObj = new MessageMedia(mimeType, base64Data);
        } else {
          mediaObj = MessageMedia.fromFilePath(media);
        }
    } catch (err) {
        console.error(`[SEND-MEDIA] Media Loading Failed: ${err.message}`);
        return res.status(400).json({
             error: true, 
             message: 'Failed to load media (timeout or bad URL)',
             details: err.message 
        });
    }
    
    console.log("[SEND-MEDIA] Sending message to WhatsApp...");
    
    let result;
    
    // 2. TIMEOUT FOR SENDING MESSAGE (60 Seconds Max)
    // Sending media is heavy. If Chrome hangs, we want to know.
    try {
        const sendPromise = message_id_to_reply 
            ? (await client.getMessageById(message_id_to_reply)).reply(mediaObj, undefined, { caption, sendSeen: false })
            : client.sendMessage(chatId, mediaObj, { 
                caption: caption, 
                sendSeen: false,
                linkPreview: false 
              });

        result = await withTimeout(sendPromise, 180000, "Send To WhatsApp");

    } catch (err) {
        console.error(`[SEND-MEDIA] Send Failed: ${err.message}`);
        
        // If this times out, it usually means the browser is unresponsive.
        // You might want to trigger a restart here if you have logic for it.
        return res.status(504).json({
            error: true,
            message: 'Sending timed out. The phone might be disconnected or the file is too large.',
            details: err.message
        });
    }

    console.log(`[SEND-MEDIA] Success! ID: ${result.id._serialized}`);
    
    res.json({
      success: true,
      messageId: result.id._serialized,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[SEND-MEDIA] Critical Error:`, error);
    res.status(500).json({
      error: true,
      message: 'Internal Server Error',
      details: error.message
    });
  }
});


router.post('/forward-message', authenticateAPI, async (req, res) => {
  try {
    const { messageId, toChatId } = req.body;
    
    console.log(`[FORWARD] Starting forward request - MessageId: ${messageId}, ToChatId: ${toChatId}`);
    
    if (!messageId || !toChatId) {
      return res.status(400).json({
        error: true,
        message: 'Missing required fields: messageId and toChatId'
      });
    }

    const client = req.client;
    
    // 1. Format the destination ID correctly
    // If user sends "12345", we convert to "12345@c.us". If group, they must send "@g.us"
    const targetChatId = toChatId.includes('@') ? toChatId : `${toChatId}@c.us`;

    console.log(`[FORWARD] Getting message by ID: ${messageId}`);
    
    // 2. TIMEOUT FOR FINDING MESSAGE (10 Seconds)
    // This talks to the browser, so it MUST have a timeout
    let message;
    try {
        message = await withTimeout(
            client.getMessageById(messageId), 
            10000, 
            "Find Message"
        );
    } catch (err) {
        console.error(`[FORWARD] Failed to find message: ${err.message}`);
        return res.status(404).json({
            error: true,
            message: 'Could not retrieve original message (Timeout or Not Found)',
            details: err.message
        });
    }
    
    if (!message) {
      return res.status(404).json({ error: true, message: 'Message not found' });
    }

    console.log(`[FORWARD] Message found. Forwarding to ${targetChatId}...`);

    // 3. TIMEOUT FOR FORWARDING (20 Seconds)
    // I removed the "Fire-and-Forget" logic.
    // It is better to await this so we know if the browser actually sent it.
    try {
        await withTimeout(
            message.forward(targetChatId), 
            20000, 
            "Forward Message"
        );
    } catch (err) {
        console.error(`[FORWARD] Forwarding failed: ${err.message}`);
        return res.status(504).json({
            error: true,
            message: 'Forwarding operation timed out or failed',
            details: err.message
        });
    }

    console.log(`[FORWARD] Message forward successful`);

    res.json({
      success: true,
      message: 'Message forwarded successfully',
      data: {
        originalMessageId: messageId,
        forwardedTo: targetChatId
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[FORWARD] Critical Error:`, error);
    res.status(500).json({
      error: true,
      message: 'Internal Server Error',
      details: error.message
    });
  }
});

// Clear messages from a specific group
router.post('/clear-group-messages', authenticateAPI, validateSession, async (req, res) => {
  try {
    const { chatId } = req.body;
    
    console.log(`[CLEAR-MESSAGES] Starting clear messages request - ChatId: ${chatId}`);
    
    // Validate required fields
    if (!chatId) {
      console.log('[CLEAR-MESSAGES] Validation failed - Missing chatId');
      return res.status(400).json({
        error: true,
        message: 'Missing required field: chatId is required',
        timestamp: new Date().toISOString()
      });
    }

    const client = req.client;
    console.log(`[CLEAR-MESSAGES] Getting chat by ID: ${chatId}`);
    
    // Get the chat by ID
    const chat = await client.getChatById(chatId);
    
    if (!chat) {
      console.log(`[CLEAR-MESSAGES] Chat not found: ${chatId}`);
      return res.status(404).json({
        error: true,
        message: 'Chat not found',
        timestamp: new Date().toISOString()
      });
    }

    // Check if the chat is a group
    if (!chat.isGroup) {
      console.log(`[CLEAR-MESSAGES] Chat is not a group: ${chatId}`);
      return res.status(400).json({
        error: true,
        message: 'Chat is not a group. Only group chats can be cleared.',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[CLEAR-MESSAGES] Clearing messages for group: ${chat.name || chatId}`);
    
    // Clear the chat messages
    await chat.clearMessages();
    
    console.log(`[CLEAR-MESSAGES] Messages cleared successfully for group: ${chat.name || chatId}`);
    
    res.json({
      success: true,
      message: 'Group messages cleared successfully',
      data: {
        chatId: chatId,
        groupName: chat.name || 'Unknown Group'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[CLEAR-MESSAGES] Error clearing messages:`, error);
    res.status(500).json({
      error: true,
      message: 'Failed to clear group messages',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;