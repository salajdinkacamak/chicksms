-- ChickSMS Database Setup SQL Script
-- For existing app_system user
-- Execute this script in MySQL as root user
-- mysql -u root -p < setup-database.sql

-- Create chicksms database with proper charset for international SMS support
CREATE DATABASE IF NOT EXISTS chicksms 
CHARACTER SET utf8mb4 
COLLATE utf8mb4_unicode_ci;

-- Grant comprehensive privileges to existing app_system user
-- Note: app_system user already exists, just granting permissions
GRANT ALL PRIVILEGES ON chicksms.* TO 'app_system'@'localhost';

-- Apply privilege changes
FLUSH PRIVILEGES;

-- Switch to the chicksms database
USE chicksms;

-- Verify database setup
SELECT 'ChickSMS Database setup completed for app_system user!' as status;
SELECT DATABASE() as current_database;

-- Display connection information
SELECT CONCAT('Database: chicksms, User: app_system, Password: Nokiae72-1!') as connection_info;

-- Create a test table to verify permissions (will be removed by Prisma)
CREATE TABLE IF NOT EXISTS setup_test (
    id INT PRIMARY KEY AUTO_INCREMENT,
    test_message VARCHAR(255) DEFAULT 'Database permissions verified for app_system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert test data
INSERT INTO setup_test (test_message) VALUES ('ChickSMS database is ready for deployment with app_system user');

-- Show test data
SELECT * FROM setup_test;

-- Clean up test table
DROP TABLE setup_test;

SELECT 'Database setup and verification completed for app_system!' as final_status;
