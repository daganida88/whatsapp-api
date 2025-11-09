# WhatsApp Web API

A Node.js REST API for WhatsApp Web with multi-session support using [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).

## Features

- 🔥 **Multi-Session Support**: Handle multiple WhatsApp accounts simultaneously
- 📱 **QR Code Authentication**: Easy session setup with QR codes
- 💬 **Message Types**: Send text messages, images, and videos
- 🚀 **Docker Ready**: Full Docker support with headless browser configuration
- 🔒 **Production Ready**: Rate limiting, validation, error handling
- 📊 **Session Management**: Monitor and manage active sessions
- 🌐 **Cross-Platform**: Works on Mac and Linux servers

## Quick Start

### Docker (Recommended)

1. **Clone and setup:**
   ```bash
   git clone <your-repo>
   cd whatsapp-api
   cp .env.example .env
   mkdir -p data/sessions data/logs
   ```

2. **Start the service:**
   ```bash
   docker-compose up -d
   ```

3. **Check health:**
   ```bash
   curl http://localhost:3000/health
   ```

### Local Development

1. **Prerequisites:**
   ```bash
   # Install Node.js 18+ and npm
   node --version  # Should be 18+
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

## API Documentation

### Base URL
```
http://localhost:3000/api
```

### Authentication Flow

#### 1. Initialize Session
```bash
POST /api/sessions/{clientId}/initialize
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/sessions/phone1/initialize
```

#### 2. Get QR Code
```bash
GET /api/sessions/{clientId}/qr
```

**Response:**
```json
{
  "success": true,
  "qr": "2@...",
  "qrImage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

#### 3. Check Session Status
```bash
GET /api/sessions/{clientId}/status
```

**Response:**
```json
{
  "success": true,
  "exists": true,
  "status": "initialized",
  "ready": true,
  "hasQR": false,
  "createdAt": 1704110400000,
  "lastActivity": 1704110400000,
  "info": {
    "wid": "123456789@c.us",
    "pushname": "Your Name"
  }
}
```

### Messaging APIs

#### Send Text Message
```bash
POST /api/send-text
Content-Type: application/json

{
  "clientId": "phone1",
  "phone": "1234567890",
  "message": "Hello from WhatsApp API!"
}
```

#### Send Image
```bash
POST /api/send-image
Content-Type: multipart/form-data

clientId=phone1
phone=1234567890
caption=Check out this image!
image=@/path/to/image.jpg
```

**Or with URL/Base64:**
```bash
POST /api/send-image
Content-Type: application/json

{
  "clientId": "phone1",
  "phone": "1234567890",
  "image": "https://example.com/image.jpg",
  "caption": "Image from URL"
}
```

#### Send Video
```bash
POST /api/send-video
Content-Type: multipart/form-data

clientId=phone1
phone=1234567890
caption=Check out this video!
video=@/path/to/video.mp4
```

### Session Management

#### List All Sessions
```bash
GET /api/sessions
```

#### List Chats and Groups
```bash
GET /api/sessions/{clientId}/chats
```

#### Logout Session
```bash
POST /api/sessions/{clientId}/logout
```

## Group Messaging

To send messages to WhatsApp groups, you need the **group ID**:

```bash
# Get list of your chats and groups
curl http://localhost:3001/api/sessions/phone1/chats

# Send message to group using group ID
curl -X POST http://localhost:3001/api/send-text \
  -H "Content-Type: application/json" \
  -d '{"clientId":"phone1","phone":"12345678901234567890@g.us","message":"Hello group!"}'
```

**Group ID Format:** `12345678901234567890@g.us`  
**Individual Chat Format:** `1234567890@c.us`

## Environment Configuration

Create `.env` file from `.env.example`:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Session Management
MAX_SESSIONS=10
SESSION_TIMEOUT=300000

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

## Multi-Session Usage

### Two WhatsApp Numbers Example

1. **Initialize first session:**
   ```bash
   curl -X POST http://localhost:3000/api/sessions/personal/initialize
   curl http://localhost:3000/api/sessions/personal/qr
   # Scan QR with first phone
   ```

2. **Initialize second session:**
   ```bash
   curl -X POST http://localhost:3000/api/sessions/business/initialize
   curl http://localhost:3000/api/sessions/business/qr
   # Scan QR with second phone
   ```

3. **Send messages from different numbers:**
   ```bash
   # From personal number
   curl -X POST http://localhost:3000/api/send-text \
     -H "Content-Type: application/json" \
     -d '{"clientId":"personal","phone":"1234567890","message":"Hi from my personal number!"}'
   
   # From business number
   curl -X POST http://localhost:3000/api/send-text \
     -H "Content-Type: application/json" \
     -d '{"clientId":"business","phone":"1234567890","message":"Hi from my business number!"}'
   ```

## Docker Deployment

### Production Deployment
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f whatsapp-api

# Scale (if needed)
docker-compose up -d --scale whatsapp-api=2

# Stop
docker-compose down
```

### With Nginx (SSL/Domain)
```bash
# Enable nginx profile
docker-compose --profile nginx up -d
```

## Troubleshooting

### Common Issues

1. **QR Code Not Generating:**
   ```bash
   # Check session status
   curl http://localhost:3000/api/sessions/{clientId}/status
   
   # Reinitialize if needed
   curl -X POST http://localhost:3000/api/sessions/{clientId}/logout
   curl -X POST http://localhost:3000/api/sessions/{clientId}/initialize
   ```

2. **Session Not Ready:**
   ```bash
   # Wait for session to be ready
   # Status should show "ready": true
   curl http://localhost:3000/api/sessions/{clientId}/status
   ```

3. **Phone Number Format:**
   - Use international format without `+`: `1234567890`
   - Don't include country code `+` or spaces
   - Example: `5511999999999` for Brazil `+55 11 99999-9999`

4. **Docker Issues:**
   ```bash
   # Check container logs
   docker-compose logs whatsapp-api
   
   # Restart service
   docker-compose restart whatsapp-api
   
   # Clean restart
   docker-compose down && docker-compose up -d
   ```

### Resource Usage

- **Memory**: ~500MB-1GB per active session
- **Storage**: ~50-100MB per session for cache/data
- **CPU**: Low usage, spikes during message sending

### Monitoring

```bash
# Health check
curl http://localhost:3000/health

# Session overview
curl http://localhost:3000/api/sessions

# Container stats
docker stats whatsapp-api
```

## Development

### Local Setup
```bash
git clone <repo>
cd whatsapp-api
npm install
cp .env.example .env
npm run dev
```

### Testing
```bash
# Test with curl
./test-api.sh

# Or use Postman collection (if available)
```

### Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit pull request

## License

MIT License - see LICENSE file for details.

## Disclaimer

This project is for educational and automation purposes only. Make sure to comply with WhatsApp's Terms of Service when using this API. The authors are not responsible for any misuse of this software.