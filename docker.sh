#!/bin/bash

# ChickSMS Docker Management Script

DOCKER_COMPOSE_FILE="docker-compose.yml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 ChickSMS Docker Manager${NC}"
echo "=========================="

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
        exit 1
    fi
}

# Function to start services
start_services() {
    echo -e "${BLUE}🚀 Starting ChickSMS services...${NC}"
    docker-compose up -d
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Services started successfully!${NC}"
        echo ""
        echo -e "${YELLOW}📋 Service URLs:${NC}"
        echo -e "  🌐 ChickSMS API: http://localhost:3000"
        echo -e "  🗄️  phpMyAdmin: http://localhost:8081"
        echo -e "  📊 MQTT Broker: localhost:1884"
        echo -e "  🔴 Redis: localhost:6380"
        echo ""
        echo -e "${YELLOW}📋 Default Credentials:${NC}"
        echo -e "  👤 Admin User: admin / admin123"
        echo -e "  🗄️  Database: chicksms / chicksms_password"
    else
        echo -e "${RED}❌ Failed to start services${NC}"
        exit 1
    fi
}

# Function to stop services
stop_services() {
    echo -e "${YELLOW}🛑 Stopping ChickSMS services...${NC}"
    docker-compose down
    echo -e "${GREEN}✅ Services stopped${NC}"
}

# Function to restart services
restart_services() {
    echo -e "${YELLOW}🔄 Restarting ChickSMS services...${NC}"
    docker-compose restart
    echo -e "${GREEN}✅ Services restarted${NC}"
}

# Function to view logs
view_logs() {
    echo -e "${BLUE}📋 Viewing logs for ChickSMS...${NC}"
    docker-compose logs -f chicksms
}

# Function to clean up
cleanup() {
    echo -e "${YELLOW}🧹 Cleaning up Docker resources...${NC}"
    docker-compose down -v
    docker system prune -f
    echo -e "${GREEN}✅ Cleanup completed${NC}"
}

# Function to show status
show_status() {
    echo -e "${BLUE}📊 Service Status:${NC}"
    docker-compose ps
}

# Function to build images
build_images() {
    echo -e "${BLUE}🔨 Building Docker images...${NC}"
    docker-compose build --no-cache
    echo -e "${GREEN}✅ Images built successfully${NC}"
}

# Function to run database migrations
run_migrations() {
    echo -e "${BLUE}🗄️  Running database migrations...${NC}"
    docker-compose exec chicksms npx prisma migrate deploy
    docker-compose exec chicksms npx prisma db seed
    echo -e "${GREEN}✅ Migrations completed${NC}"
}

# Function to open shell in container
shell() {
    echo -e "${BLUE}🐚 Opening shell in ChickSMS container...${NC}"
    docker-compose exec chicksms sh
}

# Main menu
case "$1" in
    start)
        check_docker
        start_services
        ;;
    stop)
        check_docker
        stop_services
        ;;
    restart)
        check_docker
        restart_services
        ;;
    logs)
        check_docker
        view_logs
        ;;
    status)
        check_docker
        show_status
        ;;
    build)
        check_docker
        build_images
        ;;
    clean)
        check_docker
        cleanup
        ;;
    migrate)
        check_docker
        run_migrations
        ;;
    shell)
        check_docker
        shell
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|logs|status|build|clean|migrate|shell}"
        echo ""
        echo "Commands:"
        echo "  start    - Start all services"
        echo "  stop     - Stop all services"
        echo "  restart  - Restart all services"
        echo "  logs     - View ChickSMS logs"
        echo "  status   - Show service status"
        echo "  build    - Build Docker images"
        echo "  clean    - Clean up Docker resources"
        echo "  migrate  - Run database migrations"
        echo "  shell    - Open shell in ChickSMS container"
        exit 1
        ;;
esac
