# ChickSMS Manual Deployment Guide for Ubuntu Server

This guide will walk you through manually deploying ChickSMS on your Ubuntu server with the existing `app_system` MySQL user.

## Prerequisites
- Ubuntu Server (18.04 or higher)
- Root or sudo access
- Existing MySQL user: `app_system` with password: `Nokiae72-1!`

## Step-by-Step Manual Deployment

### Step 1: System Updates
```bash
sudo apt update && sudo apt upgrade -y
```

### Step 2: Install System Dependencies
```bash
sudo apt install -y curl wget gnupg2 software-properties-common apt-transport-https ca-certificates git nginx mysql-server build-essential
```

### Step 3: Install Node.js
```bash
# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -

# Install Node.js
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

### Step 4: Install Global Tools
```bash
# Install PM2 process manager
sudo npm install -g pm2

# Install Prisma CLI
sudo npm install -g prisma@5.20.0
```

### Step 5: Install and Configure MQTT Broker
```bash
# Install Mosquitto
sudo apt install -y mosquitto mosquitto-clients

# Enable and start Mosquitto
sudo systemctl enable mosquitto
sudo systemctl start mosquitto

# Test MQTT broker
mosquitto_pub -h localhost -t test/connection -m "ChickSMS test"
```

### Step 6: Create Application Directory
```bash
# Create project directory
sudo mkdir -p /var/www/html/chicksms

# Set ownership to your user temporarily for file copying
sudo chown $USER:$USER /var/www/html/chicksms

# Navigate to project directory
cd /var/www/html/chicksms
```

### Step 7: Copy Application Files
```bash
# Option A: If you have the files locally, copy them
# scp -r /path/to/your/chicksms/* user@server:/var/www/html/chicksms/

# Option B: If using git
git clone <your-repository-url> .

# Option C: If files are already on server, ensure they're in the right location
# cp -r /path/to/source/* /var/www/html/chicksms/
```

### Step 8: Create Service User
```bash
# Create www-data user if it doesn't exist
sudo useradd -r -s /bin/false www-data 2>/dev/null || echo "www-data user already exists"
```

### Step 9: Set Up NPM Cache Directory
```bash
# Create NPM cache directory for service user
sudo mkdir -p /var/www/.npm
sudo chown -R www-data:www-data /var/www/.npm
```

### Step 10: Install Node.js Dependencies
```bash
cd /var/www/html/chicksms

# Clean any existing installation
sudo rm -rf node_modules/ package-lock.json
sudo npm cache clean --force

# For Node.js v23.x compatibility, install specific versions
sudo NPM_CONFIG_CACHE=/var/www/.npm npm install --production --no-audit --no-fund express mysql2 bcryptjs jsonwebtoken winston mqtt uuid cors helmet express-rate-limit dotenv

# Install specific Prisma versions for compatibility
sudo NPM_CONFIG_CACHE=/var/www/.npm npm install @prisma/client@5.20.0 prisma@5.20.0 --save

# Install Prisma engines for compatibility
sudo NPM_CONFIG_CACHE=/var/www/.npm npm install @prisma/engines@5.20.0 --save-dev
```

### Step 11: Create Environment Configuration
```bash
cd /var/www/html/chicksms

# Create .env file
sudo tee .env > /dev/null << EOF
NODE_ENV=production
PORT=3000
DATABASE_URL="mysql://app_system:Nokiae72-1!@localhost:3306/chicksms"
JWT_SECRET=$(openssl rand -base64 32)
JWT_EXPIRE=7d
MQTT_BROKER_URL=mqtt://localhost:1883
MQTT_TOPIC=test/topic
MQTT_CLIENT_ID=chicksms-server-production
LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF

# Set proper permissions
sudo chown www-data:www-data .env
sudo chmod 600 .env
```

### Step 12: Set Up MySQL Database
```bash
# Start MySQL if not running
sudo systemctl start mysql

# Create database and grant permissions
sudo mysql -e "CREATE DATABASE IF NOT EXISTS chicksms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "GRANT ALL PRIVILEGES ON chicksms.* TO 'app_system'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"

# Verify database access
sudo mysql -e "SHOW DATABASES;" | grep chicksms
```

### Step 13: Set File Permissions
```bash
cd /var/www/html/chicksms

# Set ownership to www-data
sudo chown -R www-data:www-data /var/www/html/chicksms

# Set proper file permissions
sudo find /var/www/html/chicksms -type f -exec chmod 644 {} \;
sudo find /var/www/html/chicksms -type d -exec chmod 755 {} \;

# Make shell scripts executable
sudo chmod +x /var/www/html/chicksms/*.sh 2>/dev/null || true

# Create logs directory
sudo mkdir -p /var/www/html/chicksms/logs
sudo chown -R www-data:www-data /var/www/html/chicksms/logs
```

### Step 14: Generate Prisma Client
```bash
cd /var/www/html/chicksms

# Set Prisma environment variables for Node.js v23.x compatibility
export PRISMA_QUERY_ENGINE_BINARY_AUTO_DOWNLOAD=1
export PRISMA_SCHEMA_ENGINE_BINARY_AUTO_DOWNLOAD=1
export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
export PRISMA_CLIENT_ENGINE_TYPE=binary

# Clear any existing Prisma cache
sudo rm -rf node_modules/.prisma
sudo rm -rf prisma/generated

# Generate Prisma client as www-data user
sudo -u www-data bash -c "
    cd /var/www/html/chicksms
    export NPM_CONFIG_CACHE=/var/www/.npm
    export PRISMA_QUERY_ENGINE_BINARY_AUTO_DOWNLOAD=1
    export PRISMA_SCHEMA_ENGINE_BINARY_AUTO_DOWNLOAD=1
    export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
    export PRISMA_CLIENT_ENGINE_TYPE=binary
    
    npx prisma generate --schema=./prisma/schema.prisma
"
```

### Step 15: Run Database Migrations
```bash
cd /var/www/html/chicksms

# Run database migrations
sudo -u www-data bash -c "
    cd /var/www/html/chicksms
    export NPM_CONFIG_CACHE=/var/www/.npm
    npx prisma db push --schema=./prisma/schema.prisma
"
```

### Step 16: Seed Database
```bash
cd /var/www/html/chicksms

# Run seeding
sudo -u www-data bash -c "
    cd /var/www/html/chicksms
    export NPM_CONFIG_CACHE=/var/www/.npm
    node prisma/seed.js
"

# If seeding fails, create admin user manually
if [ $? -ne 0 ]; then
    echo "Seeding failed, creating admin user manually..."
    sudo -u www-data bash -c "
        cd /var/www/html/chicksms
        node -e \"
        const { PrismaClient } = require('@prisma/client');
        const bcrypt = require('bcryptjs');
        
        async function createAdmin() {
            const prisma = new PrismaClient();
            try {
                const hashedPassword = await bcrypt.hash('admin123', 10);
                const admin = await prisma.user.upsert({
                    where: { username: 'admin' },
                    update: {},
                    create: {
                        username: 'admin',
                        password: hashedPassword,
                        role: 'admin'
                    }
                });
                console.log('Admin user created:', admin.username);
            } catch (error) {
                console.error('Error:', error);
            } finally {
                await prisma.\\\$disconnect();
            }
        }
        createAdmin();
        \"
    "
fi
```

### Step 17: Set Up PM2 Directories
```bash
# Create PM2 home directory for www-data user
sudo mkdir -p /var/www/.pm2
sudo chown -R www-data:www-data /var/www/.pm2

# Create PM2 subdirectories
sudo mkdir -p /var/www/.pm2/logs
sudo mkdir -p /var/www/.pm2/pids
sudo mkdir -p /var/www/.pm2/modules
sudo chown -R www-data:www-data /var/www/.pm2

# Set PM2_HOME environment variable for www-data user
echo 'export PM2_HOME=/var/www/.pm2' | sudo tee -a /home/www-data/.bashrc 2>/dev/null || true
```

### Step 18: Create PM2 Ecosystem Configuration
```bash
cd /var/www/html/chicksms

# Create PM2 ecosystem config
sudo tee ecosystem.config.js > /dev/null << 'EOF'
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
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    restart_delay: 1000
  }]
}
EOF

sudo chown www-data:www-data ecosystem.config.js
```

### Step 19: Start Application with PM2
```bash
cd /var/www/html/chicksms

# Start application as www-data user with explicit PM2_HOME
sudo -u www-data bash -c "
    export PM2_HOME=/var/www/.pm2
    cd /var/www/html/chicksms
    pm2 delete chicksms 2>/dev/null || true
    pm2 start ecosystem.config.js
    pm2 save
"

# Set up PM2 to start on boot with correct home directory
sudo env PATH=\$PATH:/usr/bin PM2_HOME=/var/www/.pm2 pm2 startup systemd -u www-data --hp /var/www
```

### Step 20: Configure Nginx
```bash
# Create Nginx configuration
sudo tee /etc/nginx/sites-available/chicksms > /dev/null << 'EOF'
server {
    listen 80;
    server_name chicksms.yourdomain.com;  # Replace with your domain

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
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/chicksms /etc/nginx/sites-enabled/

# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Step 21: Configure Log Rotation
```bash
# Set up log rotation
sudo tee /etc/logrotate.d/chicksms > /dev/null << EOF
/var/www/html/chicksms/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    copytruncate
    su www-data www-data
}
EOF
```

### Step 22: Configure Firewall
```bash
# Allow necessary ports
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP
sudo ufw allow 443/tcp     # HTTPS
sudo ufw allow 3000/tcp    # ChickSMS API
sudo ufw allow 1883/tcp    # MQTT

# Enable firewall
sudo ufw --force enable
```

### Step 23: Verify Services
```bash
# Check service status
echo "Service Status:"
echo "- MySQL: $(sudo systemctl is-active mysql)"
echo "- Nginx: $(sudo systemctl is-active nginx)"
echo "- Mosquitto: $(sudo systemctl is-active mosquitto)"

# Check PM2 status
sudo -u www-data bash -c "export PM2_HOME=/var/www/.pm2 && pm2 status"

# Check if application is responding
sleep 5
curl -f http://localhost:3000/health
```

### Step 24: Test Application
```bash
# Test health endpoint
curl -s http://localhost:3000/health | jq .

# Test authentication endpoint
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

## Troubleshooting Commands

### Fix PM2 Permission Issues (if you encounter them):
```bash
# Create PM2 directories with proper permissions
sudo mkdir -p /var/www/.pm2/{logs,pids,modules}
sudo chown -R www-data:www-data /var/www/.pm2
sudo chmod -R 755 /var/www/.pm2

# Initialize PM2 for www-data user
sudo -u www-data bash -c "export PM2_HOME=/var/www/.pm2 && pm2 ping"

# Restart PM2 daemon
sudo -u www-data bash -c "export PM2_HOME=/var/www/.pm2 && pm2 kill && pm2 resurrect"
```

### If Prisma generation fails:
```bash
# Try alternative method
cd /var/www/html/chicksms
sudo -u www-data npm install @prisma/engines@5.20.0 --save-dev
sudo -u www-data npx prisma generate --schema=./prisma/schema.prisma
```

### If PM2 fails to start:
```bash
# Check logs
sudo -u www-data bash -c "export PM2_HOME=/var/www/.pm2 && pm2 logs chicksms"

# Restart manually
sudo -u www-data bash -c "export PM2_HOME=/var/www/.pm2 && pm2 restart chicksms"
```

### If database connection fails:
```bash
# Test database connection
sudo mysql -u app_system -p'Nokiae72-1!' -e "USE chicksms; SHOW TABLES;"
```

### Check application logs:
```bash
# PM2 logs
sudo -u www-data bash -c "export PM2_HOME=/var/www/.pm2 && pm2 logs chicksms"

# Application logs
sudo tail -f /var/www/html/chicksms/logs/pm2-combined.log
```

## Final Configuration

1. **Update domain name** in `/etc/nginx/sites-available/chicksms`
2. **Install SSL certificate** (recommended: Let's Encrypt)
3. **Update DNS** to point to your server
4. **Test external access** at your domain

## Default Credentials
- **Username**: admin
- **Password**: admin123

## Important File Locations
- **Application**: `/var/www/html/chicksms`
- **Logs**: `/var/www/html/chicksms/logs`
- **Environment**: `/var/www/html/chicksms/.env`
- **Nginx Config**: `/etc/nginx/sites-available/chicksms`
- **PM2 Config**: `/var/www/html/chicksms/ecosystem.config.js`

This manual process should work more reliably than the automated script, allowing you to troubleshoot each step individually.
