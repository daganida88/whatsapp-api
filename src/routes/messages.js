const express = require('express');
const multer = require('multer');
const Joi = require('joi');
const { MessageMedia } = require('whatsapp-web.js');

const router = express.Router();

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
  message: Joi.string().min(1).max(4096).required()
});

const mediaMessageSchema = Joi.object({
  phone: phoneSchema,
  caption: Joi.string().max(1024).optional(),
  filename: Joi.string().max(255).optional()
});

// Middleware to validate request body
const validateBody = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: true,
        message: 'Validation error',
        details: error.details.map(d => d.message),
        timestamp: new Date().toISOString()
      });
    }
    next();
  };
};

// Middleware to validate client session
const validateSession = async (req, res, next) => {
  try {
    const client = req.client;
    const clientReady = req.clientReady;
    
    // Use same logic as /api/sessions endpoint
    const isReady = clientReady && client.info ? true : false;
    
    if (!client || !isReady) {
      return res.status(400).json({
        error: true,
        message: 'Client is not ready',
        clientReady: clientReady,
        hasInfo: !!client.info,
        timestamp: new Date().toISOString()
      });
    }
    
    next();
  } catch (error) {
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
router.post('/sessions/:clientId/initialize', async (req, res) => {
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
router.post('/sessions/:clientId/logout', async (req, res) => {
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
router.post('/send-text', validateBody(textMessageSchema), validateSession, async (req, res) => {
  try {
    const { phone, message } = req.body;
    const client = req.client;
    
    // Format phone number
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`;
    
    const result = await client.sendMessage(chatId, message);
    
    res.json({
      success: true,
      messageId: result.id._serialized,
      timestamp: new Date().toISOString(),
      data: {
        phone,
        message: message.substring(0, 100) + (message.length > 100 ? '...' : '')
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

// Send image
router.post('/send-image', upload.single('image'), validateBody(mediaMessageSchema), validateSession, async (req, res) => {
  try {
    const { clientId, phone, caption, filename } = req.body;
    const client = req.client;
    
    let media;
    
    if (req.file) {
      // File upload
      media = new MessageMedia(
        req.file.mimetype,
        req.file.buffer.toString('base64'),
        filename || req.file.originalname
      );
    } else if (req.body.image) {
      // Base64 or URL
      if (req.body.image.startsWith('http')) {
        media = await MessageMedia.fromUrl(req.body.image);
      } else {
        // Assume base64
        const base64Data = req.body.image.replace(/^data:image\/[a-z]+;base64,/, '');
        media = new MessageMedia('image/jpeg', base64Data, filename || 'image.jpg');
      }
    } else {
      return res.status(400).json({
        error: true,
        message: 'No image provided. Use file upload or image field with URL/base64',
        timestamp: new Date().toISOString()
      });
    }
    
    // Format phone number
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`;
    
    const options = caption ? { caption } : {};
    const result = await client.sendMessage(chatId, media, options);
    
    res.json({
      success: true,
      messageId: result.id._serialized,
      timestamp: new Date().toISOString(),
      data: {
        clientId,
        phone,
        caption: caption || '',
        filename: media.filename
      }
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: 'Failed to send image',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Send video
router.post('/send-video', upload.single('video'), validateBody(mediaMessageSchema), validateSession, async (req, res) => {
  try {
    const { clientId, phone, caption, filename } = req.body;
    const client = req.client;
    
    let media;
    
    if (req.file) {
      // File upload
      media = new MessageMedia(
        req.file.mimetype,
        req.file.buffer.toString('base64'),
        filename || req.file.originalname
      );
    } else if (req.body.video) {
      // URL or base64
      if (req.body.video.startsWith('http')) {
        media = await MessageMedia.fromUrl(req.body.video);
      } else {
        // Assume base64
        const base64Data = req.body.video.replace(/^data:video\/[a-z0-9]+;base64,/, '');
        media = new MessageMedia('video/mp4', base64Data, filename || 'video.mp4');
      }
    } else {
      return res.status(400).json({
        error: true,
        message: 'No video provided. Use file upload or video field with URL/base64',
        timestamp: new Date().toISOString()
      });
    }
    
    // Format phone number
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`;
    
    const options = caption ? { caption } : {};
    const result = await client.sendMessage(chatId, media, options);
    
    res.json({
      success: true,
      messageId: result.id._serialized,
      timestamp: new Date().toISOString(),
      data: {
        clientId,
        phone,
        caption: caption || '',
        filename: media.filename
      }
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: 'Failed to send video',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Forward message endpoint
router.post('/forward-message', async (req, res) => {
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