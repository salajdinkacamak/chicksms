-- Create database and user with proper privileges for Prisma migrations
CREATE DATABASE IF NOT EXISTS chicksms;

-- Create user with all necessary privileges
CREATE USER IF NOT EXISTS 'chicksms'@'%' IDENTIFIED BY 'chicksms_password';

-- Grant all privileges on the chicksms database
GRANT ALL PRIVILEGES ON chicksms.* TO 'chicksms'@'%';

-- Grant CREATE privilege on all databases (needed for Prisma shadow database)
GRANT CREATE ON *.* TO 'chicksms'@'%';

-- Grant DROP privilege on temporary databases (needed for Prisma shadow database)
GRANT DROP ON *.* TO 'chicksms'@'%';

-- Ensure privileges are applied
FLUSH PRIVILEGES;
