const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');
const mqttService = require('../services/mqttService');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

// Send SMS endpoint
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({ 
        error: 'Phone number and message are required' 
      });
    }

    // Validate phone number format (basic validation)
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber.replace(/[\s\-\(\)]/g, ''))) {
      return res.status(400).json({ 
        error: 'Invalid phone number format' 
      });
    }

    // Create SMS log entry
    const smsLog = await prisma.smsLog.create({
      data: {
        phoneNumber,
        message,
        status: 'PENDING',
        userId: req.user.id
      }
    });

    // Send via MQTT to Arduino
    const mqttMessage = `${phoneNumber}|${message}`;
    const success = await mqttService.publishMessage(mqttMessage);

    if (success) {
      await prisma.smsLog.update({
        where: { id: smsLog.id },
        data: { 
          status: 'SENT',
          sentAt: new Date()
        }
      });

      logger.info(`SMS queued for sending: ${phoneNumber}`);
      
      res.json({
        message: 'SMS queued for sending',
        smsId: smsLog.id,
        status: 'SENT'
      });
    } else {
      await prisma.smsLog.update({
        where: { id: smsLog.id },
        data: { 
          status: 'FAILED',
          errorMsg: 'Failed to publish to MQTT broker'
        }
      });

      res.status(500).json({
        error: 'Failed to queue SMS',
        smsId: smsLog.id
      });
    }

  } catch (error) {
    logger.error('Send SMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Retry failed SMS
router.post('/retry/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const smsLog = await prisma.smsLog.findUnique({
      where: { id }
    });

    if (!smsLog) {
      return res.status(404).json({ error: 'SMS not found' });
    }

    if (smsLog.status === 'SENT') {
      return res.status(400).json({ error: 'SMS already sent' });
    }

    // Check retry limit
    if (smsLog.retryCount >= 3) {
      return res.status(400).json({ error: 'Maximum retry attempts reached' });
    }

    // Send via MQTT
    const mqttMessage = `${smsLog.phoneNumber}|${smsLog.message}`;
    const success = await mqttService.publishMessage(mqttMessage);

    if (success) {
      await prisma.smsLog.update({
        where: { id },
        data: { 
          status: 'SENT',
          sentAt: new Date(),
          retryCount: smsLog.retryCount + 1,
          errorMsg: null
        }
      });

      logger.info(`SMS retry successful: ${smsLog.phoneNumber}`);
      
      res.json({
        message: 'SMS retry successful',
        status: 'SENT'
      });
    } else {
      await prisma.smsLog.update({
        where: { id },
        data: { 
          status: 'FAILED',
          retryCount: smsLog.retryCount + 1,
          errorMsg: 'Failed to publish to MQTT broker'
        }
      });

      res.status(500).json({
        error: 'SMS retry failed'
      });
    }

  } catch (error) {
    logger.error('Retry SMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get SMS status
router.get('/status/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const smsLog = await prisma.smsLog.findUnique({
      where: { id },
      include: {
        user: {
          select: { username: true }
        }
      }
    });

    if (!smsLog) {
      return res.status(404).json({ error: 'SMS not found' });
    }

    res.json({ sms: smsLog });

  } catch (error) {
    logger.error('Get SMS status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk SMS endpoint
router.post('/bulk', authMiddleware, async (req, res) => {
  try {
    const { recipients, message } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ 
        error: 'Recipients array is required and must not be empty' 
      });
    }

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (recipients.length > 100) {
      return res.status(400).json({ 
        error: 'Maximum 100 recipients allowed per bulk request' 
      });
    }

    const results = [];
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;

    for (const phoneNumber of recipients) {
      if (!phoneRegex.test(phoneNumber.replace(/[\s\-\(\)]/g, ''))) {
        results.push({
          phoneNumber,
          status: 'FAILED',
          error: 'Invalid phone number format'
        });
        continue;
      }

      try {
        // Create SMS log entry
        const smsLog = await prisma.smsLog.create({
          data: {
            phoneNumber,
            message,
            status: 'PENDING',
            userId: req.user.id
          }
        });

        // Send via MQTT
        const mqttMessage = `${phoneNumber}|${message}`;
        const success = await mqttService.publishMessage(mqttMessage);

        if (success) {
          await prisma.smsLog.update({
            where: { id: smsLog.id },
            data: { 
              status: 'SENT',
              sentAt: new Date()
            }
          });

          results.push({
            phoneNumber,
            status: 'SENT',
            smsId: smsLog.id
          });
        } else {
          await prisma.smsLog.update({
            where: { id: smsLog.id },
            data: { 
              status: 'FAILED',
              errorMsg: 'Failed to publish to MQTT broker'
            }
          });

          results.push({
            phoneNumber,
            status: 'FAILED',
            smsId: smsLog.id,
            error: 'Failed to queue SMS'
          });
        }

        // Add small delay between messages to avoid overwhelming
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        logger.error(`Bulk SMS error for ${phoneNumber}:`, error);
        results.push({
          phoneNumber,
          status: 'FAILED',
          error: 'Internal error'
        });
      }
    }

    const successCount = results.filter(r => r.status === 'SENT').length;
    const failureCount = results.length - successCount;

    logger.info(`Bulk SMS completed: ${successCount} sent, ${failureCount} failed`);

    res.json({
      message: 'Bulk SMS completed',
      summary: {
        total: results.length,
        sent: successCount,
        failed: failureCount
      },
      results
    });

  } catch (error) {
    logger.error('Bulk SMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
