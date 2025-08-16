#!/bin/bash

# ChickSMS Database Setup Script for Ubuntu Server
# Using existing app_system user
echo "🗄️ Setting up ChickSMS Database on Ubuntu Server"
echo "================================================"

# Database configuration - Using existing app_system user
DB_NAME="chicksms"
DB_USER="app_system"
DB_PASSWORD="Nokiae72-1!"

echo "📋 Database Configuration:"
echo "   Database: ${DB_NAME}"
echo "   User: ${DB_USER} (existing user)"
echo "   Password: ${DB_PASSWORD}"
echo ""
echo "ℹ️  Using your existing MySQL user 'app_system'"
read -p "Press Enter to continue with database creation..."

# Connect to MySQL and create database (user already exists)
echo "🔧 Creating database and granting permissions..."
mysql -u root -p << EOF
-- Create database with proper charset for international SMS
CREATE DATABASE IF NOT EXISTS ${DB_NAME} 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Grant privileges to existing app_system user
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';

-- Grant additional privileges for Prisma schema management
GRANT CREATE, ALTER, DROP, INDEX, REFERENCES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';

-- Flush privileges
FLUSH PRIVILEGES;

-- Verify database creation
SHOW DATABASES LIKE '${DB_NAME}';

-- Show granted privileges for app_system user
SHOW GRANTS FOR '${DB_USER}'@'localhost';

-- Test connection to the database
USE ${DB_NAME};
SELECT 'Database setup successful with app_system user!' as status;
SELECT DATABASE() as current_database;
SELECT USER() as current_user;

EOF

if [ $? -eq 0 ]; then
    echo "✅ Database setup completed successfully!"
    echo ""
    echo "📝 Database Connection Details:"
    echo "   Host: localhost"
    echo "   Port: 3306"
    echo "   Database: ${DB_NAME}"
    echo "   User: ${DB_USER} (existing user)"
    echo "   Password: ${DB_PASSWORD}"
    echo ""
    echo "🔧 Your DATABASE_URL for .env file:"
    echo "DATABASE_URL=\"mysql://${DB_USER}:${DB_PASSWORD}@localhost:3306/${DB_NAME}\""
    echo ""
    echo "🧪 Test the connection with:"
    echo "mysql -u ${DB_USER} -p ${DB_NAME}"
    echo "(Password: ${DB_PASSWORD})"
else
    echo "❌ Database setup failed!"
    echo "Please check your MySQL root credentials and ensure 'app_system' user exists."
    exit 1
fi

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
