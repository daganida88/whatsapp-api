# WhatsApp API Usage Guide

This guide shows how to use the WhatsApp API endpoints for sending messages and forwarding content between chats and groups.

## Base URL
```
http://localhost:3001/api
```

## Authentication
All API endpoints require an API key for authentication.

### API Key Methods
1. **Header (Recommended)**: `X-API-Key: your-api-key`
2. **Query Parameter**: `?api_key=your-api-key`

### Default API Key
- Set via environment variable: `API_KEY=your-secret-api-key`
- Default fallback: `your-secret-api-key`

## Prerequisites
- Ensure your WhatsApp client is authenticated and ready
- Check status at: `GET http://localhost:3001/api/sessions` (requires API key)
- Browse groups/chats at: `http://localhost:3001/ui`

## 1. Send Text Message

Send a text message to a contact or group.

### Endpoint
```
POST /api/send-text
```

### Request Body
```json
{
  "phone": "CHAT_ID",
  "message": "Your message text here"
}
```

### Examples

**Send to individual contact:**
```bash
curl -X POST http://localhost:3001/api/send-text \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-api-key" \
  -d '{
    "phone": "1234567890@c.us",
    "message": "Hello! This is a test message."
  }'
```

**Send to group:**
```bash
curl -X POST http://localhost:3001/api/send-text \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-api-key" \
  -d '{
    "phone": "120363400200314986@g.us",
    "message": "Hello group! 👋"
  }'
```

### Response
```json
{
  "success": true,
  "messageId": "true_1234567890@c.us_3EB06D9D3CD7DA0AA28EDD_12425357213925@lid",
  "timestamp": "2025-11-09T13:22:11.703Z",
  "data": {
    "phone": "1234567890@c.us",
    "message": "Hello! This is a test message."
  }
}
```

## 2. Send Media Message (URL Only)

Send media (images, videos, documents) from a URL with optional caption.

### Endpoint
```
POST /api/send-media
```

### Request Body
```json
{
  "phone": "CHAT_ID",
  "media": "https://example.com/media-url",
  "caption": "Optional caption"
}
```

### Example
```bash
curl -X POST http://localhost:3001/api/send-media \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-api-key" \
  -d '{
    "phone": "1234567890@c.us",
    "media": "https://example.com/image.jpg",
    "caption": "Check out this image!"
  }'
```

### Response
```json
{
  "success": true,
  "messageId": "true_1234567890@c.us_3EB06D9D3CD7DA0AA28EDD_12425357213926@lid",
  "timestamp": "2025-11-09T13:25:11.703Z",
  "data": {
    "phone": "1234567890@c.us",
    "caption": "Check out this image!",
    "mediaUrl": "https://example.com/image.jpg"
  }
}
```

## 3. Send Media Message (Image - Legacy)

Send an image with optional caption.

### Endpoint
```
POST /api/send-image
```

### Request Methods

#### Method A: File Upload
```bash
curl -X POST http://localhost:3001/api/send-image \
  -F "image=@/path/to/your/image.jpg" \
  -F "phone=1234567890@c.us" \
  -F "caption=Check out this image!" \
  -F "filename=my-image.jpg"
```

#### Method B: Base64 Encoded Image
```bash
curl -X POST http://localhost:3001/api/send-image \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "1234567890@c.us",
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ...",
    "caption": "Image sent via base64",
    "filename": "image.jpg"
  }'
```

#### Method C: Image URL
```bash
curl -X POST http://localhost:3001/api/send-image \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "1234567890@c.us",
    "image": "https://example.com/image.jpg",
    "caption": "Image from URL"
  }'
```

### Response
```json
{
  "success": true,
  "messageId": "true_1234567890@c.us_3EB06D9D3CD7DA0AA28EDD_12425357213926@lid",
  "timestamp": "2025-11-09T13:25:11.703Z",
  "data": {
    "phone": "1234567890@c.us",
    "caption": "Check out this image!",
    "filename": "my-image.jpg"
  }
}
```

## 3. Send Video Message

Send a video with optional caption.

### Endpoint
```
POST /api/send-video
```

### Request Methods

#### Method A: File Upload
```bash
curl -X POST http://localhost:3001/api/send-video \
  -F "video=@/path/to/your/video.mp4" \
  -F "phone=1234567890@c.us" \
  -F "caption=Check out this video!" \
  -F "filename=my-video.mp4"
```

#### Method B: Video URL
```bash
curl -X POST http://localhost:3001/api/send-video \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "1234567890@c.us",
    "video": "https://example.com/video.mp4",
    "caption": "Video from URL"
  }'
```

## 4. Forward Message

Forward an existing message from one chat to another.

### Endpoint
```
POST /api/forward-message
```

### Request Body
```json
{
  "messageId": "MESSAGE_ID_TO_FORWARD",
  "toChatId": "DESTINATION_CHAT_ID"
}
```

### Example
```bash
curl -X POST http://localhost:3001/api/forward-message \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "true_120363400200314986@g.us_3EB06D9D3CD7DA0AA28EDD_12425357213925@lid",
    "toChatId": "120363403302220749@g.us"
  }'
```

### Response
```json
{
  "success": true,
  "message": "Message forwarded successfully",
  "data": {
    "originalMessageId": "true_120363400200314986@g.us_3EB06D9D3CD7DA0AA28EDD_12425357213925@lid",
    "forwardedTo": "120363403302220749@g.us"
  },
  "timestamp": "2025-11-09T13:22:22.137Z"
}
```

## Chat ID Formats

### Individual Contacts
Format: `PHONE_NUMBER@c.us`
- Example: `1234567890@c.us`
- Use country code without `+` or `00`

### Groups
Format: `GROUP_ID@g.us`
- Example: `120363400200314986@g.us`
- Get group IDs from the UI at `http://localhost:3001/ui`

## Getting Message IDs

To forward a message, you need its `messageId`. You can get this from:

1. **Send response**: When you send a message, the response includes `messageId`
2. **Message history**: Use the chats API to get recent messages (if implemented)

## Error Responses

All endpoints return error responses in this format:
```json
{
  "error": true,
  "message": "Error description",
  "timestamp": "2025-11-09T13:22:11.703Z"
}
```

Common errors:
- `Client is not ready` - WhatsApp client is not authenticated
- `Validation error` - Invalid request body parameters
- `Message not found` - Invalid messageId for forwarding
- `Failed to send message` - Network or WhatsApp API error

## Web UI

Browse your chats and groups at:
```
http://localhost:3001/ui
```

The UI allows you to:
- View all your chats and groups
- Search through contacts
- Copy chat/group IDs for API usage
- Filter between groups and individual contacts

## Tips

1. **Phone number format**: Always include country code without `+` or `00`
2. **Group IDs**: Use the web UI to easily find and copy group IDs
3. **Message IDs**: Save the `messageId` from send responses if you plan to forward
4. **Media files**: Supported formats include JPG, PNG, GIF, MP4, AVI, MOV, PDF, DOC, XLS, PPT
5. **File size limit**: Maximum 64MB for media files