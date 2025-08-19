const mqtt = require('mqtt');
const logger = require('../utils/logger');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class MqttService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    try {
      const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://95.217.15.58:1883';
      const clientId = process.env.MQTT_CLIENT_ID || 'ChickSMS-Server';

      logger.info(`Connecting to MQTT broker: ${brokerUrl}`);

      this.client = mqtt.connect(brokerUrl, {
        clientId: `${clientId}-${Date.now()}`,
        clean: true,
        connectTimeout: 4000,
        reconnectPeriod: 1000,
        keepalive: 60
      });

      this.client.on('connect', () => {
        logger.info('Connected to MQTT broker');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        //debug this. If im getting any messages from the Arduino
        this.client.on('message', (topic, message) => {
          logger.info(`Received message on topic ${topic}: ${message.toString()}`);
        });

        // Subscribe to incoming SMS topic if needed
        const incomingTopic = 'sms/incoming';
        this.client.subscribe(incomingTopic, (err) => {
          if (err) {
            logger.error('Failed to subscribe to incoming SMS topic:', err);
          } else {
            logger.info(`Subscribed to ${incomingTopic}`);
          }
        });

        // Subscribe to delivery status topic
        const statusTopic = 'sms/status';
        this.client.subscribe(statusTopic, (err) => {
          if (err) {
            logger.error('Failed to subscribe to status topic:', err);
          } else {
            logger.info(`Subscribed to ${statusTopic}`);
          }
        });
      });

      this.client.on('disconnect', () => {
        logger.warn('Disconnected from MQTT broker');
        this.isConnected = false;
      });

      this.client.on('error', (error) => {
        logger.error('MQTT connection error:', error);
        this.isConnected = false;
      });

      this.client.on('offline', () => {
        logger.warn('MQTT client is offline');
        this.isConnected = false;
      });

      this.client.on('reconnect', () => {
        this.reconnectAttempts++;
        logger.info(`Attempting to reconnect to MQTT broker (attempt ${this.reconnectAttempts})`);
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          logger.error('Max reconnection attempts reached');
          this.client.end();
        }
      });

      this.client.on('message', async (topic, message) => {
        try {
          await this.handleIncomingMessage(topic, message.toString());
        } catch (error) {
          logger.error('Error handling incoming MQTT message:', error);
        }
      });

    } catch (error) {
      logger.error('Failed to initialize MQTT connection:', error);
    }
  }

  async handleIncomingMessage(topic, message) {
    logger.info(`Received message on topic ${topic}: ${message}`);

    if (topic === 'sms/incoming') {
      // Handle incoming SMS
      // Expected format: phoneNumber|message|timestamp
      const parts = message.split('|');
      if (parts.length >= 2) {
        const phoneNumber = parts[0];
        const smsMessage = parts[1];
        let timestamp = new Date();
        
        // Handle timestamp from Arduino (milliseconds since boot)
        if (parts[2]) {
          const arduinoTimestamp = parseInt(parts[2]);
          if (!isNaN(arduinoTimestamp)) {
            // If it's a small number, it's milliseconds since Arduino boot, use current time
            if (arduinoTimestamp < 1000000000000) {
              timestamp = new Date();
            } else {
              // If it's a large number, treat as Unix timestamp
              timestamp = new Date(arduinoTimestamp);
            }
          }
        }

        try {
          await prisma.incomingSms.create({
            data: {
              phoneNumber,
              message: smsMessage,
              receivedAt: timestamp
            }
          });
          logger.info(`Stored incoming SMS from ${phoneNumber}: "${smsMessage}"`);
        } catch (error) {
          logger.error('Failed to store incoming SMS:', error);
        }
      }
    } else if (topic === 'sms/status') {
      // Handle SMS delivery status
      // Expected format: phoneNumber|status|error (optional)
      const parts = message.split('|');
      if (parts.length >= 2) {
        const phoneNumber = parts[0];
        const status = parts[1];
        const errorMsg = parts[2] || null;

        logger.info(`Received SMS status update for ${phoneNumber}: ${status}${errorMsg ? ` (${errorMsg})` : ''}`);

        try {
          // Find the most recent SMS to this phone number that's not yet confirmed
          const smsLog = await prisma.smsLog.findFirst({
            where: {
              phoneNumber,
              status: { in: ['PENDING', 'RETRY', 'QUEUED'] } // Include QUEUED for bulk SMS
            },
            orderBy: { createdAt: 'desc' }
          });

          if (smsLog) {
            const updateData = {
              status: status.toUpperCase(),
              updatedAt: new Date()
            };

            if (status.toLowerCase() === 'sent') {
              updateData.sentAt = new Date();
              updateData.errorMsg = null; // Clear any previous error
            } else if (status.toLowerCase() === 'failed') {
              updateData.errorMsg = errorMsg || 'SMS delivery failed';
            }

            await prisma.smsLog.update({
              where: { id: smsLog.id },
              data: updateData
            });

            logger.info(`Updated SMS status for ${phoneNumber}: ${status} (SMS ID: ${smsLog.id})`);
          } else {
            logger.warn(`No pending SMS found for phone number: ${phoneNumber} - may have already been processed`);
          }
        } catch (error) {
          logger.error('Failed to update SMS status:', error);
        }
      }
    }
  }

  async publishMessage(message) {
    if (!this.isConnected || !this.client) {
      logger.error('MQTT client is not connected');
      return false;
    }

    try {
      const topic = process.env.MQTT_TOPIC || 'test/topic';
      
      return new Promise((resolve) => {
        this.client.publish(topic, message, { qos: 1 }, (error) => {
          if (error) {
            logger.error('Failed to publish MQTT message:', error);
            resolve(false);
          } else {
            logger.info(`Published message to ${topic}: ${message}`);
            resolve(true);
          }
        });
      });
    } catch (error) {
      logger.error('Error publishing MQTT message:', error);
      return false;
    }
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.isConnected = false;
      logger.info('Disconnected from MQTT broker');
    }
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts
    };
  }
}

module.exports = new MqttService();
