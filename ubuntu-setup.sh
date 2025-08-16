#!/bin/bash

# ChickSMS Ubuntu Server Deployment Script
echo "🚀 ChickSMS Ubuntu Server Setup"
echo "================================"

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x (if not already installed)
echo "📦 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node.js installation
echo "✅ Node.js version: $(node --version)"
echo "✅ NPM version: $(npm --version)"

# Install PM2 globally for process management
echo "📦 Installing PM2..."
sudo npm install -g pm2

# Install MQTT Broker (Mosquitto)
echo "📦 Installing MQTT Broker (Mosquitto)..."
sudo apt update
sudo apt install -y mosquitto mosquitto-clients

# Enable and start Mosquitto
sudo systemctl enable mosquitto
sudo systemctl start mosquitto

# Test MQTT
echo "🧪 Testing MQTT..."
mosquitto_pub -h localhost -t test/connection -m "ChickSMS MQTT Test" &
sleep 1
mosquitto_sub -h localhost -t test/connection -C 1

echo "✅ Ubuntu server setup complete!"
echo "Next steps:"
echo "1. Clone your ChickSMS repository"
echo "2. Configure environment variables"
echo "3. Set up database"
echo "4. Configure nginx"
echo "5. Start with PM2"
