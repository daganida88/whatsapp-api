const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const { MessageMedia } = require('whatsapp-web.js');

const router = express.Router();

// API Key from environment
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY;

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
  message_id_to_reply: Joi.string().optional()
});

const mediaMessageSchema = Joi.object({
  phone: phoneSchema,
  media: Joi.string().required(),
  base64Data: Joi.string().optional(),
  mimeType: Joi.string().optional(),
  caption: Joi.string().min(1).max(4096).optional(),
  message_id_to_reply: Joi.string().allow(null).optional()
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
    res.status(500).json({
      error: true,
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get chats (including groups) for a session
router.get('/sessions/:clientId/chats', async (req, res) => {
  try {
    console.log(`[CHATS] Loading chats for session: ${req.params.clientId}`);
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
    
    const formattedChats = chats.map(chat => ({
      id: chat.id._serialized,
      name: chat.name || 'No Name',
      isGroup: chat.isGroup,
      participants: chat.isGroup ? chat.participants?.length || 0 : 1,
      lastMessage: chat.lastMessage?.body?.substring(0, 50) || 'No messages',
      timestamp: chat.timestamp
    }));

    console.log(`[CHATS] Formatted ${formattedChats.length} chats, ${formattedChats.filter(c => c.isGroup).length} groups`);

    res.json({
      success: true,
      chats: formattedChats,
      groups: formattedChats.filter(chat => chat.isGroup),
      contacts: formattedChats.filter(chat => !chat.isGroup),
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
    
    // Format phone number
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`;
    
    // Prepare options for reply
    const options = {};
    if (message_id_to_reply) {
      options.quotedMessageId = message_id_to_reply;
    }
    
    const result = await client.sendMessage(chatId, message, options);
    
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
    res.status(500).json({
      error: true,
      message: 'Failed to send text message',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Send media (URL only)
router.post('/send-media', authenticateAPI, validateBody(mediaMessageSchema), validateSession, async (req, res) => {
  try {
    console.log(`[SEND-MEDIA] Starting send media request`);
    const { phone, media, caption, message_id_to_reply } = req.body;
    const client = req.client;
        
    if (!media) {
      console.log(`[SEND-MEDIA] Media is required`);
      return res.status(400).json({
        error: true,
        message: 'Media URL or local path is required',
        providedMedia: media,
        timestamp: new Date().toISOString()
      });
    }
    
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`;
    console.log(`[SEND-MEDIA] Formatted chat ID: ${chatId}`);
    
    let mediaObj;
    if (media.startsWith('http')) {
      console.log(`[SEND-MEDIA] Fetching media from URL: ${media}`);
      mediaObj = await MessageMedia.fromUrl(media, { unsafeMime: true });
      console.log(`[SEND-MEDIA] Media fetched from URL, type: ${mediaObj.mimetype}`);
    } else if (media.startsWith('data:') || req.body.base64Data) {
      console.log(`[SEND-MEDIA] Creating media from base64 data`);
      const mimeType = req.body.mimeType || 'image/jpeg';
      const base64Data = req.body.base64Data || media.split(',')[1]; // Handle data:image/jpeg;base64,... format
      mediaObj = new MessageMedia(mimeType, base64Data);
      console.log(`[SEND-MEDIA] Media created from base64, type: ${mediaObj.mimetype}`);
    } else {
      console.log(`[SEND-MEDIA] Loading media from local path: ${media}`);
      try {
        mediaObj = MessageMedia.fromFilePath(media);
        console.log(`[SEND-MEDIA] Media loaded from file, type: ${mediaObj.mimetype}`);
      } catch (fileError) {
        console.log(`[SEND-MEDIA] File not found: ${media}`, fileError.message);
        return res.status(400).json({
          error: true,
          message: 'File not found or cannot be read',
          providedPath: media,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // Prepare options for caption and reply
    const options = {};
    if (caption) {
      options.caption = caption;
    }
    if (message_id_to_reply) {
      options.quotedMessageId = message_id_to_reply;
    }
    console.log("[SEND-MEDIA] Sending message");
    
    const result = await client.sendMessage(chatId, mediaObj, options);
    console.log(`[SEND-MEDIA] Message sent successfully, ID: ${result.id._serialized}`);
    
    res.json({
      success: true,
      messageId: result.id._serialized,
      timestamp: new Date().toISOString(),
      data: {
        phone: chatId,
        caption: caption || '',
        mediaUrl: media,
        replyTo: message_id_to_reply || null
      }
    });
    
  } catch (error) {
    console.error(`[SEND-MEDIA] Error:`, error);
    res.status(500).json({
      error: true,
      message: 'Failed to send media',
      details: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
});


// Forward message endpoint
router.post('/forward-message', authenticateAPI, async (req, res) => {
  try {
    const { messageId, toChatId } = req.body;
    
    console.log(`[FORWARD] Starting forward request - MessageId: ${messageId}, ToChatId: ${toChatId}`);
    
    // Validate required fields
    if (!messageId || !toChatId) {
      console.log('[FORWARD] Validation failed - Missing required fields');
      return res.status(400).json({
        error: true,
        message: 'Missing required fields: messageId and toChatId are required',
        timestamp: new Date().toISOString()
      });
    }

    // Get the client
    const client = req.client;
    const clientReady = req.clientReady;
    
    if (!client || !clientReady || !client.info) {
      console.log(`[FORWARD] Client is not ready`);
      return res.status(400).json({
        error: true,
        message: 'Client is not ready',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[FORWARD] Getting message by ID: ${messageId}`);
    
    // Get the message by ID
    const message = await client.getMessageById(messageId);
    
    if (!message) {
      console.log(`[FORWARD] Message not found: ${messageId}`);
      return res.status(404).json({
        error: true,
        message: 'Message not found',
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[FORWARD] Message found, forwarding to: ${toChatId}`);
    
    // Forward the message
    await message.forward(toChatId);
    
    console.log(`[FORWARD] Message forwarded successfully from ${messageId} to ${toChatId}`);
    
    res.json({
      success: true,
      message: 'Message forwarded successfully',
      data: {
        originalMessageId: messageId,
        forwardedTo: toChatId
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[FORWARD] Error forwarding message:`, error);
    res.status(500).json({
      error: true,
      message: 'Failed to forward message',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;