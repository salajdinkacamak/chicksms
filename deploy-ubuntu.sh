#!/bin/bash

# ChickSMS Ubuntu Production Deployment Script
# This script handles Prisma compatibility issues with Node.js v23.x
# Tested for Ubuntu Server with existing app_system MySQL user

set -e

echo "🚀 Starting ChickSMS Production Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Configuration
PROJECT_DIR="/var/www/html/chicksms"
SERVICE_USER="www-data"

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    log_error "Please run this script with sudo"
    log_info "Usage: sudo ./deploy-ubuntu.sh"
    exit 1
fi

# Step 1: System Updates
log_info "Step 1: Updating system packages..."
apt update && apt upgrade -y

# Step 2: Install Required System Packages
log_info "Step 2: Installing system dependencies..."
apt install -y curl wget gnupg2 software-properties-common apt-transport-https ca-certificates git nginx mysql-server build-essential

# Step 3: Check Node.js version and handle Prisma compatibility
log_info "Step 3: Checking Node.js version..."
NODE_VERSION=$(node --version 2>/dev/null || echo "none")
log_info "Current Node.js version: $NODE_VERSION"

# If Node.js v23.x, we need to use compatible Prisma versions
if [[ "$NODE_VERSION" == *"v23"* ]]; then
    log_warning "Node.js v23.x detected. Using Prisma compatibility mode."
    PRISMA_MODE="compatible"
else
    PRISMA_MODE="standard"
fi

# Step 4: Install Node.js (if needed)
if ! command_exists node; then
    log_info "Step 4: Installing Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
else
    log_info "Step 4: Node.js already installed: $(node --version)"
fi

# Step 5: Install PM2
log_info "Step 5: Installing PM2..."
npm install -g pm2

# Step 6: Install Mosquitto MQTT Broker
log_info "Step 6: Installing Mosquitto MQTT Broker..."
apt install -y mosquitto mosquitto-clients
systemctl enable mosquitto
systemctl start mosquitto

# Test MQTT broker
log_info "Testing MQTT broker..."
if mosquitto_pub -h localhost -t test/connection -m "ChickSMS deployment test" 2>/dev/null; then
    log_info "MQTT broker is working"
else
    log_warning "MQTT broker test failed - check mosquitto service"
fi

# Step 7: Create service user if not exists
if ! id "$SERVICE_USER" &>/dev/null; then
    log_info "Creating service user: $SERVICE_USER"
    useradd -r -s /bin/false $SERVICE_USER
else
    log_info "Service user $SERVICE_USER already exists"
fi

# Step 8: Create Application Directory
log_info "Step 8: Setting up application directory..."
mkdir -p $PROJECT_DIR
chown $USER:$USER $PROJECT_DIR
cd $PROJECT_DIR

# Step 9: Clone or Copy Application
if [ -d ".git" ]; then
    log_info "Step 9: Pulling latest changes..."
    git pull
else
    log_info "Step 9: Please copy your application files to $PROJECT_DIR"
    log_warning "Make sure to copy all files including package.json, src/, prisma/, etc."
    read -p "Press Enter when files are copied..."
fi

# Step 10: Clean any existing installation
log_info "Step 10: Cleaning previous installation..."
rm -rf node_modules/ 2>/dev/null || true
rm -f package-lock.json 2>/dev/null || true
npm cache clean --force 2>/dev/null || true

# Step 11: Install Dependencies with Prisma Compatibility
log_info "Step 11: Installing Node.js dependencies..."

# Install dependencies based on Node.js version
if [ "$PRISMA_MODE" = "compatible" ]; then
    log_warning "Using Prisma compatibility mode for Node.js v23.x"
    
    # Install core dependencies first
    npm install --production --no-audit --no-fund express mysql2 bcryptjs jsonwebtoken winston mqtt uuid cors helmet express-rate-limit dotenv
    
    # Install specific Prisma versions
    npm install @prisma/client@5.20.0 prisma@5.20.0 --save
    
    # Install engines for compatibility
    npm install @prisma/engines@5.20.0 --save-dev
else
    npm install --production
fi

# Step 12: Environment Configuration
log_info "Step 12: Setting up environment configuration..."
if [ ! -f ".env" ]; then
    if [ -f ".env.production" ]; then
        cp .env.production .env
        log_info "Environment file created from .env.production"
    else
        log_warning "No environment template found. Creating basic .env..."
        cat > .env << EOF
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
    fi
    chown $SERVICE_USER:$SERVICE_USER .env
    chmod 600 .env
fi

# Step 13: Database Setup
log_info "Step 13: Setting up MySQL database..."

# Check if MySQL is running
if ! systemctl is-active --quiet mysql; then
    systemctl start mysql
fi

# Execute database setup
if [ -f "setup-database.sql" ]; then
    log_info "Executing database setup SQL..."
    mysql < setup-database.sql
else
    # Manual database setup
    log_info "Creating database manually..."
    mysql -e "CREATE DATABASE IF NOT EXISTS chicksms;"
    mysql -e "GRANT ALL PRIVILEGES ON chicksms.* TO 'app_system'@'localhost';"
    mysql -e "FLUSH PRIVILEGES;"
fi

# Step 14: Prisma Setup with Compatibility Handling
log_info "Step 14: Setting up Prisma..."

# Set Prisma environment variables for compatibility
export PRISMA_QUERY_ENGINE_BINARY_AUTO_DOWNLOAD=1
export PRISMA_SCHEMA_ENGINE_BINARY_AUTO_DOWNLOAD=1
export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
export PRISMA_CLIENT_ENGINE_TYPE=binary

# Clear any existing Prisma cache
rm -rf node_modules/.prisma
rm -rf prisma/generated

# Generate Prisma client with error handling
log_info "Generating Prisma client..."
sudo -u $SERVICE_USER bash -c "
    cd $PROJECT_DIR
    export PRISMA_QUERY_ENGINE_BINARY_AUTO_DOWNLOAD=1
    export PRISMA_SCHEMA_ENGINE_BINARY_AUTO_DOWNLOAD=1
    export PRISMA_CLI_QUERY_ENGINE_TYPE=binary
    export PRISMA_CLIENT_ENGINE_TYPE=binary
    
    npx prisma generate --schema=./prisma/schema.prisma
" || {
    log_warning "Standard Prisma generation failed, trying alternative method..."
    
    # Alternative: Use specific engine versions
    sudo -u $SERVICE_USER bash -c "
        cd $PROJECT_DIR
        npm install @prisma/engines@5.20.0 --save-dev
        npx prisma generate --schema=./prisma/schema.prisma
    " || {
        log_error "Prisma generation failed. Manual intervention required."
        exit 1
    }
}

# Step 15: Database Migration and Seeding
log_info "Step 15: Running database migrations..."
sudo -u $SERVICE_USER bash -c "
    cd $PROJECT_DIR
    npx prisma db push --schema=./prisma/schema.prisma
" || {
    log_warning "Migration failed, trying alternative..."
    sudo -u $SERVICE_USER bash -c "
        cd $PROJECT_DIR
        npx prisma migrate deploy --schema=./prisma/schema.prisma
    " || log_warning "Migration issues - database may need manual setup"
}

# Seed database with error handling
log_info "Step 15.1: Seeding database..."
if [ -f "prisma/seed.js" ]; then
    sudo -u $SERVICE_USER bash -c "
        cd $PROJECT_DIR
        node prisma/seed.js
    " || {
        log_warning "Seeding failed, trying alternative methods..."
        
        # Alternative seeding method
        cat > temp_seed.js << 'EOF'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
    const prisma = new PrismaClient();
    
    try {
        // Create admin user
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
        console.error('Seeding error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
EOF
        
        sudo -u $SERVICE_USER bash -c "
            cd $PROJECT_DIR
            node temp_seed.js
        " && rm temp_seed.js || {
            log_error "All seeding methods failed. You'll need to create admin user manually."
        }
    }
else
    log_warning "No seed file found. Skipping seeding."
fi

# Step 16: Application Build
log_info "Step 16: Building application..."
if [ -f "package.json" ] && grep -q "\"build\":" package.json; then
    sudo -u $SERVICE_USER bash -c "
        cd $PROJECT_DIR
        npm run build
    " || log_warning "Build script failed or not needed"
fi

# Step 17: Fix permissions
log_info "Step 17: Setting proper file permissions..."
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR
find $PROJECT_DIR -type f -exec chmod 644 {} \;
find $PROJECT_DIR -type d -exec chmod 755 {} \;
chmod +x $PROJECT_DIR/*.sh 2>/dev/null || true

# Create logs directory
mkdir -p $PROJECT_DIR/logs
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/logs

# Step 18: PM2 Configuration
log_info "Step 18: Configuring PM2..."

# Create PM2 ecosystem config if not exists
if [ ! -f "$PROJECT_DIR/ecosystem.config.js" ]; then
    log_info "Creating PM2 ecosystem configuration..."
    cat > $PROJECT_DIR/ecosystem.config.js << 'EOF'
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
    chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/ecosystem.config.js
fi

# Start application with PM2
log_info "Starting ChickSMS application..."
sudo -u $SERVICE_USER bash -c "
    cd $PROJECT_DIR
    pm2 delete chicksms 2>/dev/null || true
    pm2 start ecosystem.config.js
    pm2 save
"

# Setup PM2 startup script
log_info "Setting up PM2 to start on boot..."
env PATH=$PATH:/usr/bin pm2 startup systemd -u $SERVICE_USER --hp /var/www

# Step 19: Nginx Configuration
log_info "Step 19: Configuring Nginx..."
tee /etc/nginx/sites-available/chicksms > /dev/null << 'EOF'
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

ln -sf /etc/nginx/sites-available/chicksms /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Step 20: Configure log rotation
log_info "Step 20: Setting up log rotation..."
cat > /etc/logrotate.d/chicksms << EOF
$PROJECT_DIR/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    copytruncate
    su $SERVICE_USER $SERVICE_USER
}
EOF

# Step 21: Firewall Configuration
log_info "Step 21: Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw allow 1883/tcp  # MQTT
echo "y" | ufw enable 2>/dev/null || ufw --force enable

# Step 22: Final Service Checks
log_info "Step 22: Checking services..."
echo ""
echo "Service Status:"
echo "- MySQL: $(systemctl is-active mysql)"
echo "- Nginx: $(systemctl is-active nginx)"
echo "- Mosquitto: $(systemctl is-active mosquitto)"
echo "- PM2: $(sudo -u $SERVICE_USER pm2 list | grep chicksms | awk '{print $10}' || echo 'not running')"

# Step 23: Application Health Check
log_info "Step 23: Testing application..."
sleep 5

if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    log_info "✅ Application is running successfully!"
else
    log_warning "⚠️  Application health check failed. Check logs with: sudo -u $SERVICE_USER pm2 logs chicksms"
fi

# Final Instructions
echo ""
log_info "🎉 Deployment completed!"
echo ""
echo "Next steps:"
echo "1. Update the server_name in /etc/nginx/sites-available/chicksms with your domain"
echo "2. Install SSL certificate (Let's Encrypt recommended)"
echo "3. Update DNS to point to this server"
echo "4. Test the application at http://your-domain"
echo ""
echo "Useful commands:"
echo "- View logs: sudo -u $SERVICE_USER pm2 logs chicksms"
echo "- Restart app: sudo -u $SERVICE_USER pm2 restart chicksms"
echo "- Check status: sudo -u $SERVICE_USER pm2 status"
echo "- Nginx reload: systemctl reload nginx"
echo ""
echo "Application should be running on http://localhost:3000"
echo "Default admin credentials: admin / admin123"
