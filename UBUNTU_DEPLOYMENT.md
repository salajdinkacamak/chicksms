# 🚀 ChickSMS Ubuntu Server Deployment Guide

## Overview
This guide will help you deploy ChickSMS on your Ubuntu server with your existing MySQL and nginx setup.

## Prerequisites Checklist
- ✅ Ubuntu Server (18.04+)
- ✅ MySQL Server (existing)
- ✅ Nginx (existing)
- ✅ Root or sudo access
- ✅ Domain/subdomain configured

---

## Step 1: Server Preparation

### 1.1 Transfer Files to Server
```bash
# Option A: Using Git (recommended)
git clone https://github.com/salajdinkacamak/chicksms.git /var/www/chicksms

# Option B: Using SCP
scp -r /path/to/local/chicksms user@your-server:/var/www/
```

### 1.2 Run Server Setup
```bash
cd /var/www/chicksms
sudo ./ubuntu-setup.sh
```

This installs:
- Node.js 18
- PM2 process manager
- Mosquitto MQTT broker

---

## Step 2: Database Configuration

### 2.1 Create Database and User
```bash
# Edit the password in the script first!
sudo nano database-setup.sh
# Change: DB_PASSWORD="your_strong_password_here"

# Run database setup
./database-setup.sh
```

### 2.2 Verify Database Connection
```bash
mysql -u chicksms_user -p chicksms
# Should connect successfully
```

---

## Step 3: Application Setup

### 3.1 Install Dependencies
```bash
cd /var/www/chicksms
npm ci --production
```

### 3.2 Configure Environment
```bash
# Copy production environment template
cp .env.production .env

# Edit with your actual values
nano .env
```

**Required changes in `.env`:**
```bash
# Update database URL with your password
DATABASE_URL="mysql://chicksms_user:YOUR_ACTUAL_PASSWORD@localhost:3306/chicksms"

# Generate a secure JWT secret
JWT_SECRET=$(openssl rand -base64 32)
```

### 3.3 Setup Database Schema
```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

# Create admin user
npm run prisma:seed
```

---

## Step 4: Nginx Configuration

### 4.1 Create Nginx Configuration
```bash
# Copy the nginx config
sudo cp nginx-chicksms.conf /etc/nginx/sites-available/chicksms

# Edit with your domain
sudo nano /etc/nginx/sites-available/chicksms
# Change: server_name sms.yourdomain.com;

# Enable the site
sudo ln -s /etc/nginx/sites-available/chicksms /etc/nginx/sites-enabled/

# Test nginx configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### 4.2 Configure SSL (Let's Encrypt)
```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d sms.yourdomain.com

# Verify auto-renewal
sudo certbot renew --dry-run
```

---

## Step 5: Start Application

### 5.1 Start with PM2
```bash
cd /var/www/chicksms

# Start the application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions shown
```

### 5.2 Verify Application
```bash
# Check PM2 status
pm2 status

# Check application logs
pm2 logs chicksms

# Test health endpoint
curl http://localhost:3000/health

# Test via nginx
curl https://sms.yourdomain.com/health
```

---

## Step 6: Security Setup

### 6.1 Firewall Configuration
```bash
# Allow nginx
sudo ufw allow 'Nginx Full'

# Allow SSH
sudo ufw allow ssh

# Allow MQTT (if needed externally)
sudo ufw allow 1883

# Enable firewall
sudo ufw enable
```

### 6.2 Setup Log Rotation
```bash
# Create logrotate configuration
sudo tee /etc/logrotate.d/chicksms << EOF
/var/www/chicksms/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    copytruncate
}
EOF
```

---

## Step 7: Testing & Verification

### 7.1 Test API Endpoints
```bash
# Test login
curl -X POST https://sms.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

# Save the token and test SMS
TOKEN="your_jwt_token_here"
curl -X POST https://sms.yourdomain.com/api/sms/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"phoneNumber": "+1234567890", "message": "Test from production!"}'
```

### 7.2 Test MQTT
```bash
# Subscribe to SMS topic
mosquitto_sub -h localhost -t test/topic -v &

# The above curl SMS test should show a message here
```

---

## Step 8: Monitoring Setup

### 8.1 PM2 Monitoring
```bash
# View real-time logs
pm2 logs chicksms --lines 100

# Monitor resources
pm2 monit

# Restart application
pm2 restart chicksms

# View detailed info
pm2 show chicksms
```

### 8.2 Health Checks
```bash
# Add to crontab for monitoring
crontab -e

# Add this line:
*/5 * * * * curl -f https://sms.yourdomain.com/health > /dev/null 2>&1 || echo "ChickSMS down" | mail -s "ChickSMS Alert" admin@yourdomain.com
```

---

## Step 9: Arduino ESP32 Configuration

Update your Arduino code to point to production:

```cpp
const char* mqtt_server = "your-server-ip";  // Your Ubuntu server IP
const char* api_endpoint = "https://sms.yourdomain.com";
```

---

## Step 10: Backup Strategy

### 10.1 Database Backup
```bash
# Create backup script
cat > /var/www/chicksms/backup-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/chicksms"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

mysqldump -u chicksms_user -p chicksms > $BACKUP_DIR/chicksms_$DATE.sql
gzip $BACKUP_DIR/chicksms_$DATE.sql

# Keep only last 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
EOF

chmod +x /var/www/chicksms/backup-db.sh

# Add to crontab (daily backup at 2 AM)
echo "0 2 * * * /var/www/chicksms/backup-db.sh" | crontab -
```

---

## Troubleshooting

### Common Issues & Solutions

#### 1. Application Won't Start
```bash
# Check logs
pm2 logs chicksms

# Check database connection
npx prisma db push

# Restart PM2
pm2 restart chicksms
```

#### 2. Database Connection Error
```bash
# Test MySQL connection
mysql -u chicksms_user -p chicksms

# Check .env file
cat .env | grep DATABASE_URL
```

#### 3. Nginx Issues
```bash
# Check nginx configuration
sudo nginx -t

# Check nginx logs
sudo tail -f /var/log/nginx/error.log
```

#### 4. SSL Certificate Issues
```bash
# Renew certificate
sudo certbot renew

# Check certificate status
sudo certbot certificates
```

#### 5. MQTT Not Working
```bash
# Check Mosquitto status
sudo systemctl status mosquitto

# Test MQTT locally
mosquitto_pub -h localhost -t test/topic -m "test"
mosquitto_sub -h localhost -t test/topic
```

---

## Production Checklist

Before going live, verify:

- ✅ Database is secure and backed up
- ✅ SSL certificate is installed
- ✅ Firewall is configured
- ✅ PM2 is set to start on boot
- ✅ Log rotation is configured
- ✅ Monitoring is in place
- ✅ API endpoints are working
- ✅ MQTT broker is functional
- ✅ Admin password is changed
- ✅ JWT secret is secure and unique

---

## Quick Commands Reference

```bash
# Application Management
pm2 restart chicksms      # Restart app
pm2 logs chicksms         # View logs
pm2 monit                 # Monitor resources

# Database
npx prisma migrate deploy # Apply migrations
npx prisma studio         # Database GUI
npm run prisma:seed       # Create admin user

# Nginx
sudo systemctl reload nginx     # Reload config
sudo nginx -t                   # Test config

# MQTT
sudo systemctl status mosquitto  # Check status
mosquitto_sub -h localhost -t '#' -v  # Monitor all topics

# SSL
sudo certbot renew         # Renew certificates
```

---

## Success! 🎉

Your ChickSMS microservice is now running in production on Ubuntu with:

- ✅ **High Performance**: PM2 process management
- ✅ **Security**: SSL, firewall, nginx reverse proxy
- ✅ **Reliability**: Auto-restart, monitoring, backups
- ✅ **Scalability**: Ready for Arduino integration
- ✅ **Monitoring**: Comprehensive logging and health checks

Your SMS microservice is production-ready! 🚀
