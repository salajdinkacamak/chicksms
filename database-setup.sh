#!/bin/bash

# ChickSMS Database Setup Script for Ubuntu Server
echo "🗄️ Setting up ChickSMS Database on Ubuntu Server"
echo "================================================"

# Database configuration
DB_NAME="chicksms"
DB_USER="chicksms_user"
DB_PASSWORD="your_strong_password_here"  # Change this!

echo "⚠️  Please ensure you have updated the DB_PASSWORD in this script!"
read -p "Press Enter to continue or Ctrl+C to abort..."

# Connect to MySQL and create database and user
echo "🔧 Creating database and user..."
mysql -u root -p << EOF
-- Create database
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create user
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';

-- Grant privileges
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';

-- Flush privileges
FLUSH PRIVILEGES;

-- Show databases
SHOW DATABASES;

-- Show user
SELECT User, Host FROM mysql.user WHERE User = '${DB_USER}';
EOF

echo "✅ Database setup complete!"
echo "📝 Database Details:"
echo "   Database: ${DB_NAME}"
echo "   User: ${DB_USER}"
echo "   Password: ${DB_PASSWORD}"
echo ""
echo "🔧 Update your .env file with:"
echo "DATABASE_URL=\"mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}\""
