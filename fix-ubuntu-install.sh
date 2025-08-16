#!/bin/bash

# ChickSMS Ubuntu Fix Script
# Run this script to fix npm permissions and installation issues

echo "🔧 Fixing ChickSMS Installation Issues on Ubuntu"
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "Please run this script with sudo"
    exit 1
fi

PROJECT_DIR="/var/www/html/chicksms"  # Updated path based on your error
SERVICE_USER="www-data"

# Step 1: Navigate to project directory
if [ ! -d "$PROJECT_DIR" ]; then
    print_error "Project directory $PROJECT_DIR not found!"
    exit 1
fi

cd "$PROJECT_DIR"
print_status "Working in: $(pwd)"

# Step 2: Fix npm cache permissions
print_status "Fixing npm cache permissions..."
chown -R $SERVICE_USER:$SERVICE_USER /var/www/.npm 2>/dev/null || true
chown -R $SERVICE_USER:$SERVICE_USER /home/$SERVICE_USER/.npm 2>/dev/null || true

# Step 3: Clean up corrupted node_modules
print_status "Cleaning up corrupted node_modules..."
rm -rf node_modules/
rm -rf package-lock.json

# Step 4: Fix project permissions
print_status "Fixing project file permissions..."
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR

# Step 5: Clear npm cache
print_status "Clearing npm cache..."
sudo -u $SERVICE_USER npm cache clean --force

# Step 6: Install dependencies with proper user
print_status "Installing dependencies as $SERVICE_USER..."
sudo -u $SERVICE_USER npm install --production --no-save

# Step 7: Generate Prisma client
print_status "Generating Prisma client..."
sudo -u $SERVICE_USER npx prisma generate

# Step 8: Run database migrations
print_status "Running database migrations..."
sudo -u $SERVICE_USER npx prisma migrate deploy

# Step 9: Create admin user
print_status "Creating admin user..."
sudo -u $SERVICE_USER npm run prisma:seed

# Step 10: Set final permissions
print_status "Setting final permissions..."
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR
chmod -R 755 $PROJECT_DIR
chmod -R 644 $PROJECT_DIR/src/
chmod +x $PROJECT_DIR/src/server.js

# Step 11: Create logs directory with proper permissions
mkdir -p $PROJECT_DIR/logs
chown -R $SERVICE_USER:$SERVICE_USER $PROJECT_DIR/logs
chmod 755 $PROJECT_DIR/logs

print_status "🎉 Installation fixes completed!"
echo ""
echo "📋 Next steps:"
echo "1. Start the application: sudo -u $SERVICE_USER pm2 start ecosystem.config.js"
echo "2. Check status: sudo -u $SERVICE_USER pm2 status"
echo "3. View logs: sudo -u $SERVICE_USER pm2 logs chicksms"
echo "4. Test API: curl http://localhost:3000/health"
