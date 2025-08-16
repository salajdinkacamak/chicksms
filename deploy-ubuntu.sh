#!/bin/bash

# ChickSMS Quick Deployment Script for Ubuntu Server
# Run this script as: ./deploy-ubuntu.sh

set -e  # Exit on any error

echo "🚀 ChickSMS Ubuntu Deployment Script"
echo "===================================="

# Configuration
PROJECT_DIR="/var/www/chicksms"
SERVICE_USER="www-data"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    print_error "Please run this script with sudo"
    exit 1
fi

# Step 1: Install dependencies
print_status "Installing system dependencies..."
apt update && apt upgrade -y

# Install Node.js 18
if ! command -v node &> /dev/null; then
    print_status "Installing Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
else
    print_status "Node.js already installed: $(node --version)"
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
    print_status "Installing PM2..."
    npm install -g pm2
else
    print_status "PM2 already installed"
fi

# Install Mosquitto
if ! command -v mosquitto &> /dev/null; then
    print_status "Installing Mosquitto MQTT broker..."
    apt install -y mosquitto mosquitto-clients
    systemctl enable mosquitto
    systemctl start mosquitto
else
    print_status "Mosquitto already installed"
fi

# Step 2: Setup project directory
print_status "Setting up project directory..."
mkdir -p $PROJECT_DIR
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR

# Step 3: Check if this is run from the project directory
if [ -f "package.json" ] && grep -q "chicksms" package.json; then
    print_status "Copying files from current directory to $PROJECT_DIR..."
    cp -r . $PROJECT_DIR/
    chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR
else
    print_warning "Not running from ChickSMS project directory."
    print_warning "Please ensure your ChickSMS files are in $PROJECT_DIR"
fi

# Step 4: Install Node.js dependencies
cd $PROJECT_DIR
if [ -f "package.json" ]; then
    print_status "Installing Node.js dependencies..."
    sudo -u $SERVICE_USER npm ci --production
else
    print_error "package.json not found in $PROJECT_DIR"
    exit 1
fi

# Step 5: Setup environment file
if [ ! -f ".env" ]; then
    if [ -f ".env.production" ]; then
        print_status "Creating .env from .env.production template..."
        cp .env.production .env
        print_warning "Please edit .env file with your actual database credentials!"
        print_warning "Run: sudo nano $PROJECT_DIR/.env"
    else
        print_error ".env.production template not found!"
        exit 1
    fi
else
    print_status ".env file already exists"
fi

# Step 6: Setup database (interactive)
print_warning "Database setup required!"
echo "Please ensure MySQL is running and you have root access."
read -p "Do you want to run the database setup script? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [ -f "database-setup.sh" ]; then
        chmod +x database-setup.sh
        print_status "Running database setup..."
        ./database-setup.sh
    else
        print_error "database-setup.sh not found!"
    fi
fi

# Step 7: Generate Prisma client and run migrations
print_status "Setting up database schema..."
sudo -u $SERVICE_USER npx prisma generate
sudo -u $SERVICE_USER npx prisma migrate deploy

# Step 8: Create admin user
print_status "Creating admin user..."
sudo -u $SERVICE_USER npm run prisma:seed

# Step 9: Setup PM2
print_status "Setting up PM2..."
sudo -u $SERVICE_USER pm2 start ecosystem.config.js
sudo -u $SERVICE_USER pm2 save

# Setup PM2 startup
pm2 startup systemd -u $SERVICE_USER --hp /var/www
systemctl enable pm2-$SERVICE_USER

# Step 10: Setup log rotation
print_status "Setting up log rotation..."
cat > /etc/logrotate.d/chicksms << EOF
$PROJECT_DIR/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    copytruncate
    su $SERVICE_USER $SERVICE_USER
}
EOF

# Step 11: Setup nginx configuration
if command -v nginx &> /dev/null; then
    if [ -f "nginx-chicksms.conf" ]; then
        print_status "Setting up nginx configuration..."
        cp nginx-chicksms.conf /etc/nginx/sites-available/chicksms
        
        print_warning "Please edit /etc/nginx/sites-available/chicksms"
        print_warning "Update the server_name with your actual domain!"
        
        # Don't auto-enable, let user review first
        print_warning "After editing the config, run:"
        print_warning "sudo ln -s /etc/nginx/sites-available/chicksms /etc/nginx/sites-enabled/"
        print_warning "sudo nginx -t && sudo systemctl reload nginx"
    fi
else
    print_warning "Nginx not found. Please install nginx first."
fi

# Step 12: Setup firewall
print_status "Configuring firewall..."
ufw allow ssh
ufw allow 'Nginx Full'
ufw allow 1883  # MQTT
ufw --force enable

# Final status check
print_status "Checking application status..."
sleep 5
sudo -u $SERVICE_USER pm2 status

print_status "🎉 ChickSMS deployment completed!"
echo ""
echo "📋 Next Steps:"
echo "1. Edit .env file: sudo nano $PROJECT_DIR/.env"
echo "2. Update nginx config: sudo nano /etc/nginx/sites-available/chicksms"
echo "3. Enable nginx site: sudo ln -s /etc/nginx/sites-available/chicksms /etc/nginx/sites-enabled/"
echo "4. Test nginx config: sudo nginx -t"
echo "5. Reload nginx: sudo systemctl reload nginx"
echo "6. Setup SSL: sudo certbot --nginx -d yourdomain.com"
echo "7. Test API: curl http://localhost:3000/health"
echo ""
echo "🔐 Default admin credentials:"
echo "Username: admin"
echo "Password: admin123"
echo ""
echo "📁 Project location: $PROJECT_DIR"
echo "📊 Monitor with: sudo -u $SERVICE_USER pm2 monit"
