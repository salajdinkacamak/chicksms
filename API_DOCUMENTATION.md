# ChickSMS API Documentation

## ✅ **SUCCESSFULLY DEPLOYED AND TESTED**

Your ChickSMS microservice is now running successfully in Docker containers on your local environment!

## 🚀 **Quick Start**

### Local Environment (Docker)

```bash
# Navigate to project
cd /Users/salajdinkacamak/chicksms

# Start all services
./docker.sh start

# Stop all services
./docker.sh stop

# Rebuild containers
./docker.sh build
```

### Services Overview

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| ChickSMS API | 3000 | http://localhost:3000 | Main microservice |
| MySQL Database | 3306 | localhost:3306 | Data storage |
| phpMyAdmin | 8080 | http://localhost:8080 | DB management |
| MQTT Broker | 1883 | localhost:1883 | Arduino communication |
| Redis | 6379 | localhost:6379 | Caching |

## 🔐 **Authentication**

### Admin Credentials
- **Username:** `admin`
- **Password:** `admin123`

### Login Example
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {"id": "...", "username": "admin"}
}
```

## 📱 **API Endpoints**

### Health Check
```bash
curl http://localhost:3000/health
```

### Authentication Endpoints

#### 1. Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

#### 2. Get Profile
```bash
GET /api/auth/profile
Authorization: Bearer YOUR_JWT_TOKEN
```

#### 3. Change Password
```bash
POST /api/auth/change-password
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "currentPassword": "admin123",
  "newPassword": "newPassword123"
}
```

### SMS Endpoints

#### 1. Send Single SMS
```bash
POST /api/sms/send
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "phoneNumber": "+1234567890",
  "message": "Hello from ChickSMS!"
}
```

#### 2. Send Bulk SMS
```bash
POST /api/sms/send-bulk
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "recipients": [
    {"phoneNumber": "+1234567890", "message": "Message 1"},
    {"phoneNumber": "+0987654321", "message": "Message 2"}
  ]
}
```

#### 3. Retry Failed SMS
```bash
POST /api/sms/retry/:smsId
Authorization: Bearer YOUR_JWT_TOKEN
```

### Logging Endpoints

#### 1. Get SMS Logs
```bash
GET /api/logs/sms?page=1&limit=20&status=SENT
Authorization: Bearer YOUR_JWT_TOKEN
```

**Query Parameters:**
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `status`: Filter by status (PENDING, SENT, FAILED)
- `phoneNumber`: Filter by phone number
- `startDate`: Start date filter (ISO format)
- `endDate`: End date filter (ISO format)
- `userId`: Filter by user ID

#### 2. Get SMS Statistics
```bash
GET /api/logs/stats
Authorization: Bearer YOUR_JWT_TOKEN
```

**Example Response:**
```json
{
  "summary": {
    "total": 2,
    "sent": 2,
    "failed": 0,
    "pending": 0,
    "successRate": "100.00"
  },
  "incoming": {"total": 0},
  "dailyStats": [{"_count": 2, "status": "SENT"}],
  "topRecipients": [{"phoneNumber": "+1234567890", "count": 2}]
}
```

#### 3. Get Incoming SMS
```bash
GET /api/logs/incoming
Authorization: Bearer YOUR_JWT_TOKEN
```

#### 4. Get Login Attempts
```bash
GET /api/logs/login-attempts
Authorization: Bearer YOUR_JWT_TOKEN
```

## 🔌 **MQTT Integration**

### Topics
- **Outgoing SMS:** `test/topic` 
  - Format: `phoneNumber|message`
- **Incoming SMS:** `sms/incoming`
  - Format: `{"phoneNumber": "+1234567890", "message": "incoming text"}`
- **Delivery Status:** `sms/status`
  - Format: `{"smsId": "...", "status": "delivered", "timestamp": "..."}`

### Arduino ESP32 Integration
Your ESP32 should:
1. Connect to MQTT broker at `localhost:1883`
2. Subscribe to `test/topic` for outgoing SMS
3. Publish to `sms/incoming` for received SMS
4. Publish to `sms/status` for delivery confirmations

## 🗄️ **Database Schema**

### Users Table
- `id`: Primary key (UUID)
- `username`: Unique username
- `password`: Hashed password (bcrypt)
- `isActive`: Account status
- `createdAt`, `updatedAt`: Timestamps

### SmsLog Table
- `id`: Primary key (UUID)
- `phoneNumber`: Recipient phone number
- `message`: SMS content
- `status`: PENDING, SENT, FAILED
- `sentAt`: Delivery timestamp
- `errorMsg`: Error message if failed
- `retryCount`: Number of retry attempts
- `userId`: Foreign key to Users
- `createdAt`, `updatedAt`: Timestamps

### IncomingSms Table
- `id`: Primary key (UUID)
- `phoneNumber`: Sender phone number
- `message`: SMS content
- `receivedAt`: Timestamp
- `processed`: Processing status

### LoginAttempt Table
- `id`: Primary key (UUID)
- `username`: Login username
- `success`: Login success status
- `ipAddress`: Client IP
- `userAgent`: Client user agent
- `createdAt`: Timestamp

## 🔧 **Development Tools**

### Database Management
- **phpMyAdmin:** http://localhost:8080
  - Server: `mysql`
  - Username: `chicksms_user`
  - Password: `chicksms_password`
  - Database: `chicksms`

### Prisma Commands (inside container)
```bash
# Generate client
docker exec -it chicksms-chicksms-1 npx prisma generate

# Run migrations
docker exec -it chicksms-chicksms-1 npx prisma migrate dev

# Reset database
docker exec -it chicksms-chicksms-1 npx prisma migrate reset

# Prisma Studio
docker exec -it chicksms-chicksms-1 npx prisma studio
```

## 🌐 **Production Deployment on Ubuntu Server**

### Requirements for Your Ubuntu Server
Since your production has MySQL with nginx, you'll need:

1. **Node.js 18+**
2. **PM2** (Process Manager)
3. **Nginx** (Reverse proxy)
4. **MySQL** (Existing)

### Production Setup Steps

#### 1. Transfer Code to Server
```bash
# Copy your project to server
scp -r /Users/salajdinkacamak/chicksms user@your-server:/var/www/

# Or use git
git clone your-repo /var/www/chicksms
```

#### 2. Environment Setup
```bash
# Install dependencies
cd /var/www/chicksms
npm ci --production

# Set production environment variables
cat > .env << EOF
NODE_ENV=production
DATABASE_URL="mysql://username:password@localhost:3306/chicksms"
JWT_SECRET="your-super-secret-jwt-key-change-this"
MQTT_BROKER_URL="mqtt://localhost:1883"
PORT=3000
EOF
```

#### 3. Database Setup
```bash
# Run Prisma migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate

# Seed admin user
npm run prisma:seed
```

#### 4. PM2 Configuration
```bash
# Install PM2 globally
npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'chicksms',
    script: 'src/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
}
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### 5. Nginx Configuration
```nginx
# Add to your nginx configuration
server {
    listen 80;
    server_name sms.yourdomain.com;  # Your subdomain

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

#### 6. SSL Certificate (Let's Encrypt)
```bash
# Install certbot
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d sms.yourdomain.com
```

#### 7. MQTT Broker Setup (Production)
```bash
# Install Mosquitto
sudo apt update
sudo apt install mosquitto mosquitto-clients

# Configure Mosquitto
sudo systemctl enable mosquitto
sudo systemctl start mosquitto

# Test MQTT
mosquitto_pub -h localhost -t test/topic -m "Hello MQTT"
```

### Production Environment Variables
```env
NODE_ENV=production
DATABASE_URL=mysql://your_user:your_password@localhost:3306/chicksms
JWT_SECRET=your-super-secret-production-jwt-key
MQTT_BROKER_URL=mqtt://localhost:1883
PORT=3000
LOG_LEVEL=info
```

## 🔒 **Security Considerations**

1. **Change Default Password**: Update admin password after deployment
2. **JWT Secret**: Use a strong, unique JWT secret for production
3. **Rate Limiting**: Already implemented (100 requests per 15 minutes)
4. **Input Validation**: All endpoints validate input data
5. **SQL Injection Protection**: Prisma ORM provides protection
6. **CORS**: Configure CORS for your domain only in production
7. **HTTPS**: Always use SSL certificates in production
8. **Database Security**: Use strong database passwords and limit access

## 📊 **Monitoring & Logs**

### Application Logs
```bash
# View PM2 logs
pm2 logs chicksms

# View specific log lines
pm2 logs chicksms --lines 100
```

### Database Monitoring
- Monitor MySQL performance
- Set up database backups
- Monitor disk space usage

### MQTT Monitoring
```bash
# Subscribe to all topics for monitoring
mosquitto_sub -h localhost -t '#' -v
```

## 🔄 **Integration Examples**

### Arduino ESP32 Code Example
```cpp
#include <WiFi.h>
#include <PubSubClient.h>

const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASSWORD";
const char* mqtt_server = "your-server-ip";

WiFiClient espClient;
PubSubClient client(espClient);

void callback(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, "test/topic") == 0) {
    // Parse phone|message format
    String message = String((char*)payload).substring(0, length);
    int pipeIndex = message.indexOf('|');
    String phone = message.substring(0, pipeIndex);
    String smsText = message.substring(pipeIndex + 1);
    
    // Send SMS via GSM module here
    sendSMS(phone, smsText);
    
    // Send delivery confirmation
    String status = "{\"smsId\":\"" + getSmsId() + "\",\"status\":\"delivered\"}";
    client.publish("sms/status", status.c_str());
  }
}

void setup() {
  // WiFi and MQTT setup
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
  client.subscribe("test/topic");
}
```

### SSO Integration Example
```javascript
// Middleware for SSO validation
const validateSSO = async (req, res, next) => {
  try {
    const ssoToken = req.headers['x-sso-token'];
    
    // Validate with your SSO provider
    const user = await validateSSOToken(ssoToken);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid SSO token' });
    }
    
    // Find or create user in ChickSMS
    let chicksmsUser = await prisma.user.findUnique({
      where: { username: user.username }
    });
    
    if (!chicksmsUser) {
      chicksmsUser = await prisma.user.create({
        data: {
          username: user.username,
          password: 'SSO_USER', // Placeholder
          isActive: true
        }
      });
    }
    
    req.user = chicksmsUser;
    next();
  } catch (error) {
    res.status(401).json({ error: 'SSO validation failed' });
  }
};
```

---

## 🎉 **SUCCESS CONFIRMATION**

✅ **ChickSMS is fully operational!**

- ✅ Docker containers running
- ✅ MySQL database connected
- ✅ Authentication working
- ✅ SMS sending functional
- ✅ MQTT publishing active
- ✅ Logging system operational
- ✅ Statistics API working
- ✅ All endpoints tested

Your microservice is ready for production deployment on your Ubuntu server!

---

*Generated: August 16, 2025*
