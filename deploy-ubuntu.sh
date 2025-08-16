#!/bin/bash

# ChickSMS Production Deployment Script for Ubuntu Server
# Compatible with Node.js v23.x and modern npm versions
# Run this script as: sudo ./deploy-ubuntu.sh

set -e  # Exit on any error

echo "🚀 ChickSMS Ubuntu Production Deployment"
echo "========================================"
echo "Node.js v23.x Compatible Version"
echo ""

# Configuration
PROJECT_DIR="/var/www/chicksms"
SERVICE_USER="www-data"
REQUIRED_NODE_VERSION="20"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to compare versions
version_ge() {
    printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    print_error "Please run this script with sudo"
    print_info "Usage: sudo ./deploy-ubuntu.sh"
    exit 1
fi

print_info "Starting ChickSMS deployment..."
print_info "Target directory: $PROJECT_DIR"
print_info "Service user: $SERVICE_USER"
echo ""

# Step 1: System Update
print_status "Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt update && apt upgrade -y

# Step 2: Install system dependencies
print_status "Installing system dependencies..."
apt install -y curl wget gnupg2 software-properties-common apt-transport-https ca-certificates build-essential

# Step 3: Handle Node.js installation
print_status "Checking Node.js installation..."
if command_exists node; then
    CURRENT_NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    print_info "Current Node.js version: $(node --version)"
    
    if [ "$CURRENT_NODE_VERSION" -ge "$REQUIRED_NODE_VERSION" ]; then
        print_status "Node.js version is compatible (v$CURRENT_NODE_VERSION >= v$REQUIRED_NODE_VERSION)"
    else
        print_warning "Node.js version is too old. Installing Node.js 20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi
else
    print_status "Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

print_info "Node.js version: $(node --version)"
print_info "npm version: $(npm --version)"

# Step 4: Install PM2 process manager
print_status "Installing PM2 process manager..."
if ! command_exists pm2; then
    npm install -g pm2@latest
    print_status "PM2 installed: $(pm2 --version)"
else
    print_status "PM2 already installed: $(pm2 --version)"
fi

# Step 5: Install and configure Mosquitto MQTT broker
print_status "Installing Mosquitto MQTT broker..."
if ! command_exists mosquitto; then
    apt install -y mosquitto mosquitto-clients
    systemctl enable mosquitto
    systemctl start mosquitto
    print_status "Mosquitto MQTT broker installed and started"
else
    print_status "Mosquitto already installed"
    systemctl restart mosquitto
fi

# Test MQTT broker
print_info "Testing MQTT broker..."
if mosquitto_pub -h localhost -t test/connection -m "ChickSMS deployment test" 2>/dev/null; then
    print_status "MQTT broker is working"
else
    print_warning "MQTT broker test failed - check mosquitto service"
fi

# Step 6: Create service user if not exists
if ! id "$SERVICE_USER" &>/dev/null; then
    print_status "Creating service user: $SERVICE_USER"
    useradd -r -s /bin/false $SERVICE_USER
else
    print_status "Service user $SERVICE_USER already exists"
fi

# Step 7: Setup project directory
print_status "Setting up project directory: $PROJECT_DIR"
mkdir -p $PROJECT_DIR
mkdir -p $(dirname $PROJECT_DIR)/.npm
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR
chown -R $SERVICE_USER:$SERVICE_USER $(dirname $PROJECT_DIR)/.npm

# Step 8: Deploy application files
if [ -f "package.json" ] && grep -q "chicksms" package.json; then
    print_status "Copying application files..."
    
    # Copy files with proper ownership
    cp -r . $PROJECT_DIR/
    
    # Fix ownership of all files
    chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR
    
    # Set proper permissions
    find $PROJECT_DIR -type f -exec chmod 644 {} \;
    find $PROJECT_DIR -type d -exec chmod 755 {} \;
    chmod +x $PROJECT_DIR/*.sh 2>/dev/null || true
    
    print_status "Application files deployed successfully"
else
    print_error "Not running from ChickSMS project directory!"
    print_info "Please ensure you're running this script from the ChickSMS project root"
    print_info "The directory should contain package.json with 'chicksms' in the name"
    exit 1
fi

cd $PROJECT_DIR

# Step 9: Clean any existing installation
print_status "Cleaning previous installation..."
sudo -u $SERVICE_USER bash -c "
    cd $PROJECT_DIR
    rm -rf node_modules/ 2>/dev/null || true
    rm -f package-lock.json 2>/dev/null || true
    npm cache clean --force 2>/dev/null || true
"

# Step 10: Install Node.js dependencies
print_status "Installing Node.js dependencies..."
sudo -u $SERVICE_USER bash -c "
    cd $PROJECT_DIR
    export NPM_CONFIG_CACHE=$PROJECT_DIR/.npm
    npm install --production --no-audit --no-fund --legacy-peer-deps
"

if [ $? -ne 0 ]; then
    print_error "npm install failed. Trying alternative approach..."
    
    # Alternative installation method
    print_status "Attempting installation with npm ci..."
    sudo -u $SERVICE_USER bash -c "
        cd $PROJECT_DIR
        export NPM_CONFIG_CACHE=$PROJECT_DIR/.npm
        npm ci --production --no-audit --no-fund
    " || {
        print_error "npm ci also failed. Installing dependencies individually..."
        
        # Install critical dependencies manually
        sudo -u $SERVICE_USER bash -c "
            cd $PROJECT_DIR
            export NPM_CONFIG_CACHE=$PROJECT_DIR/.npm
            npm install --production --no-audit --no-fund @prisma/client express mysql2 bcryptjs jsonwebtoken winston mqtt uuid cors helmet express-rate-limit dotenv
        "
    }
fi

# Step 11: Setup environment configuration
print_status "Setting up environment configuration..."
if [ ! -f "$PROJECT_DIR/.env" ]; then
    if [ -f "$PROJECT_DIR/.env.production" ]; then
        cp $PROJECT_DIR/.env.production $PROJECT_DIR/.env
        print_info "Created .env from .env.production template"
    else
        print_warning "No environment template found. Creating basic .env..."
        cat > $PROJECT_DIR/.env << EOF
NODE_ENV=production
PORT=3000
DATABASE_URL="mysql://chicksms_user:CHANGE_THIS_PASSWORD@localhost:3306/chicksms"
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
    chown $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/.env
    chmod 600 $PROJECT_DIR/.env
    
    print_warning "⚠️  IMPORTANT: Edit $PROJECT_DIR/.env with your database credentials!"
    print_info "Run: sudo nano $PROJECT_DIR/.env"
else
    print_status "Environment file already exists"
fi

# Step 12: Database setup prompt
print_warning "Database Configuration Required!"
echo ""
print_info "Before proceeding, ensure your MySQL database is configured:"
print_info "1. Database 'chicksms' exists"
print_info "2. User 'chicksms_user' has full access to the database"
print_info "3. Update the DATABASE_URL in .env file"
echo ""

read -p "Have you configured the database? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Proceeding with database setup..."
else
    print_warning "Please configure the database first, then run this command:"
    print_info "sudo -u $SERVICE_USER bash -c 'cd $PROJECT_DIR && npx prisma migrate deploy && npm run prisma:seed'"
    print_info "Then start the service with: sudo -u $SERVICE_USER pm2 start $PROJECT_DIR/ecosystem.config.js"
    exit 0
fi

# Step 13: Generate Prisma client and run migrations
print_status "Setting up database schema..."
sudo -u $SERVICE_USER bash -c "
    cd $PROJECT_DIR
    npx prisma generate
    npx prisma migrate deploy
"

if [ $? -ne 0 ]; then
    print_error "Database setup failed!"
    print_info "Please check your database configuration in .env file"
    print_info "Then run manually: sudo -u $SERVICE_USER bash -c 'cd $PROJECT_DIR && npx prisma migrate deploy'"
    exit 1
fi

# Step 14: Create admin user
print_status "Creating admin user..."
sudo -u $SERVICE_USER bash -c "
    cd $PROJECT_DIR
    npm run prisma:seed
"

# Step 15: Setup PM2 process management
print_status "Setting up PM2 process management..."

# Create PM2 ecosystem config if not exists
if [ ! -f "$PROJECT_DIR/ecosystem.config.js" ]; then
    print_status "Creating PM2 ecosystem configuration..."
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

# Create logs directory
mkdir -p $PROJECT_DIR/logs
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/logs

# Start application with PM2
print_status "Starting ChickSMS application..."
sudo -u $SERVICE_USER bash -c "
    cd $PROJECT_DIR
    pm2 delete chicksms 2>/dev/null || true
    pm2 start ecosystem.config.js
    pm2 save
"

# Setup PM2 startup script
print_status "Setting up PM2 to start on boot..."
env PATH=$PATH:/usr/bin pm2 startup systemd -u $SERVICE_USER --hp $PROJECT_DIR

# Step 16: Configure log rotation
print_status "Setting up log rotation..."
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

# Step 17: Setup firewall
print_status "Configuring firewall..."
ufw allow ssh
ufw allow 'Nginx Full'
ufw allow 1883/tcp comment 'MQTT Broker'
ufw allow 3000/tcp comment 'ChickSMS API'
echo "y" | ufw enable 2>/dev/null || ufw --force enable

# Step 18: Health checks and verification
print_status "Running health checks..."
sleep 5

# Check PM2 status
sudo -u $SERVICE_USER pm2 status

# Check if application is responding
print_status "Testing application health..."
if curl -f http://localhost:3000/health &>/dev/null; then
    print_status "✅ Application health check passed!"
else
    print_warning "Application health check failed. Checking logs..."
    sudo -u $SERVICE_USER pm2 logs chicksms --lines 20
fi

# Step 19: Nginx configuration prompt
if command_exists nginx; then
    print_status "Nginx detected. Setting up reverse proxy configuration..."
    
    if [ -f "$PROJECT_DIR/nginx-chicksms.conf" ]; then
        cp $PROJECT_DIR/nginx-chicksms.conf /etc/nginx/sites-available/chicksms
        
        print_warning "Nginx configuration copied to /etc/nginx/sites-available/chicksms"
        print_info "Please edit the configuration and update the server_name:"
        print_info "sudo nano /etc/nginx/sites-available/chicksms"
        print_info ""
        print_info "Then enable the site:"
        print_info "sudo ln -s /etc/nginx/sites-available/chicksms /etc/nginx/sites-enabled/"
        print_info "sudo nginx -t && sudo systemctl reload nginx"
    else
        print_warning "nginx-chicksms.conf not found in project"
    fi
else
    print_info "Nginx not detected. Install nginx for reverse proxy setup."
fi

# Final success message
echo ""
print_status "🎉 ChickSMS deployment completed successfully!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
print_info "📋 NEXT STEPS:"
echo "1. 🔧 Configure database: sudo nano $PROJECT_DIR/.env"
echo "2. 🌐 Setup nginx: Edit /etc/nginx/sites-available/chicksms"
echo "3. 🔒 Setup SSL: sudo certbot --nginx -d yourdomain.com"
echo "4. 🧪 Test API: curl http://localhost:3000/health"
echo ""
print_info "🔐 DEFAULT ADMIN CREDENTIALS:"
echo "Username: admin"
echo "Password: admin123"
echo ""
print_info "📊 MANAGEMENT COMMANDS:"
echo "• Monitor: sudo -u $SERVICE_USER pm2 monit"
echo "• Logs: sudo -u $SERVICE_USER pm2 logs chicksms"
echo "• Restart: sudo -u $SERVICE_USER pm2 restart chicksms"
echo "• Status: sudo -u $SERVICE_USER pm2 status"
echo ""
print_info "📁 PROJECT LOCATION: $PROJECT_DIR"
print_info "🌐 API HEALTH: http://localhost:3000/health"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Show current PM2 processes
print_status "Current PM2 processes:"
sudo -u $SERVICE_USER pm2 list
