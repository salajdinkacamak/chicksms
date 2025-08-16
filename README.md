# ChickSMS - SMS Management System

A Node.js microservice with MySQL database using Prisma ORM for managing SMS operations with JWT authentication, logging, and MQTT integration for Arduino ESP32.

## Features

- 🔐 **JWT Authentication** - Secure token-based authentication for SSO integration
- 📱 **SMS Management** - Send single or bulk SMS messages
- 📊 **Comprehensive Logging** - Track all SMS operations with detailed logs
- 🔄 **Retry Mechanism** - Automatic retry for failed SMS
- 📥 **Incoming SMS** - Store and manage incoming SMS messages
- 🌐 **MQTT Integration** - Communicate with Arduino ESP32 via MQTT
- 📈 **Statistics & Analytics** - View SMS statistics and performance metrics
- 🔒 **Security** - Rate limiting, helmet, and JWT authentication

## Prerequisites

- Node.js (v16 or higher)
- MySQL (v8 or higher)
- MQTT Broker (Mosquitto recommended)
- Arduino ESP32 with SIM800L module

## Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd chicksms
```

2. **Install dependencies:**
```bash
npm install
```

3. **Environment Configuration:**
```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:
```env
# Database
DATABASE_URL="mysql://username:password@localhost:3306/chicksms"

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here

# MQTT Configuration
MQTT_BROKER_URL=mqtt://192.168.1.58:1883
MQTT_TOPIC=test/topic
```

4. **Database Setup:**
```bash
# Generate Prisma client
npm run prisma:generate

# Run database migrations
npm run prisma:migrate

# Seed the database with admin user
npm run prisma:seed
```

5. **Start the application:**
```bash
# Development mode
npm run dev

# Production mode
npm start
```

## Database Schema

### Users Table
- User management with JWT authentication
- Password hashing with bcrypt
- Active/inactive status

### SMS Logs Table
- Track all outgoing SMS messages
- Status tracking (PENDING, SENT, FAILED, RETRY)
- Retry count and error messages
- User association

### Incoming SMS Table
- Store incoming SMS messages
- Processing status tracking
- Timestamp information

### Login Attempts Table
- Log all authentication attempts
- IP address and user agent tracking
- Success/failure tracking

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with username and password
- `GET /api/auth/profile` - Get user profile
- `POST /api/auth/change-password` - Change password
- `GET /api/auth/verify` - Verify JWT token

### SMS Management
- `POST /api/sms/send` - Send single SMS
- `POST /api/sms/bulk` - Send bulk SMS (max 100 recipients)
- `POST /api/sms/retry/:id` - Retry failed SMS
- `GET /api/sms/status/:id` - Get SMS status

### Logs & Analytics
- `GET /api/logs/sms` - Get SMS logs with pagination and filtering
- `GET /api/logs/incoming` - Get incoming SMS logs
- `GET /api/logs/failed` - Get failed SMS for retry queue
- `GET /api/logs/stats` - Get SMS statistics and analytics
- `GET /api/logs/login-attempts` - Get login attempt logs
- `PUT /api/logs/incoming/:id/processed` - Mark incoming SMS as processed

## MQTT Integration

### Topics

1. **Outgoing SMS** (`test/topic`):
   - Format: `phoneNumber|message`
   - Published by server to Arduino

2. **Incoming SMS** (`sms/incoming`):
   - Format: `phoneNumber|message|timestamp`
   - Published by Arduino to server

3. **SMS Status** (`sms/status`):
   - Format: `phoneNumber|status|error`
   - Published by Arduino to server for delivery confirmation

## Arduino ESP32 Integration

Your existing Arduino code is compatible. The server will:
1. Publish SMS requests to the configured MQTT topic
2. Listen for incoming SMS and delivery status updates
3. Update database records based on Arduino responses

## Security Features

- **Rate Limiting**: Configurable request limits per IP
- **Helmet**: Security headers for Express
- **JWT Authentication**: Secure API access
- **Password Hashing**: bcrypt for secure password storage
- **Input Validation**: Comprehensive input validation
- **CORS**: Configurable cross-origin resource sharing

## Usage Examples

### Send Single SMS
```bash
curl -X POST http://localhost:3000/api/sms/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+1234567890",
    "message": "Hello, this is a test message!"
  }'
```

### Send Bulk SMS
```bash
curl -X POST http://localhost:3000/api/sms/bulk \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recipients": ["+1234567890", "+0987654321"],
    "message": "Bulk message to multiple recipients"
  }'
```

### Get SMS Statistics
```bash
curl -X GET http://localhost:3000/api/logs/stats \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Monitoring & Logging

- **Winston Logger**: Structured logging with multiple levels
- **File Logging**: Separate error and combined logs
- **Console Logging**: Development environment console output
- **MQTT Status**: Connection status monitoring
- **Database Metrics**: SMS statistics and performance tracking

## Development

### Database Management
```bash
# View database in Prisma Studio
npm run prisma:studio

# Reset database
npm run prisma:migrate reset

# Deploy migrations to production
npm run prisma:deploy
```

### Project Structure
```
src/
├── middleware/      # Express middleware
├── routes/          # API route handlers
├── services/        # Business logic services
├── utils/           # Utility functions
└── server.js        # Main application file
```

## Production Deployment

1. Set `NODE_ENV=production` in environment
2. Configure production database URL
3. Set secure JWT secrets
4. Configure MQTT broker for production
5. Set up reverse proxy (nginx recommended)
6. Configure SSL/TLS certificates
7. Set up process manager (PM2 recommended)

## Troubleshooting

### Common Issues

1. **MQTT Connection Failed**
   - Check broker URL and port
   - Verify network connectivity
   - Check firewall settings

2. **Database Connection Error**
   - Verify MySQL server is running
   - Check database credentials
   - Ensure database exists

3. **JWT Authentication Failed**
   - Verify JWT secret is properly set
   - Check token expiration
   - Ensure proper token format

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.
