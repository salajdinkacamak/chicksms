const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');
const mqttService = require('../services/mqttService');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();
const DELAY_BETWEEN_MESSAGES  = 20000; // 20 seconds - safe delay to prevent Arduino overwhelm and carrier blocking

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

    // Send via MQTT to Arduino (individual SMS)
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

// Get bulk SMS status summary
router.get('/bulk-status', authMiddleware, async (req, res) => {
  try {
    const { userId, timeframe = '1h' } = req.query;
    
    // Calculate time filter
    const now = new Date();
    let timeFilter;
    
    switch (timeframe) {
      case '1h':
        timeFilter = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        timeFilter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        timeFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        timeFilter = new Date(now.getTime() - 60 * 60 * 1000);
    }

    // Build where clause
    const whereClause = {
      createdAt: {
        gte: timeFilter
      }
    };

    // If specific user requested (admin only feature)
    if (userId && req.user.role === 'admin') {
      whereClause.userId = userId;
    } else {
      whereClause.userId = req.user.id;
    }

    // Get status summary
    const statusSummary = await prisma.smsLog.groupBy({
      by: ['status'],
      where: whereClause,
      _count: {
        status: true
      }
    });

    // Get recent SMS logs
    const recentSMS = await prisma.smsLog.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        phoneNumber: true,
        status: true,
        createdAt: true,
        sentAt: true,
        errorMsg: true
      }
    });

    // Format summary
    const summary = {
      total: 0,
      queued: 0,
      pending: 0,
      sent: 0,
      failed: 0
    };

    statusSummary.forEach(item => {
      summary.total += item._count.status;
      summary[item.status.toLowerCase()] = item._count.status;
    });

    res.json({
      timeframe,
      summary,
      recentSMS
    });

  } catch (error) {
    logger.error('Get bulk SMS status error:', error);
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

    if (recipients.length > 50) {
      return res.status(400).json({ 
        error: 'Maximum 50 recipients allowed per bulk request to prevent overwhelming the system' 
      });
    }

    const results = [];
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    let processedCount = 0;

    // First, validate all phone numbers and create database entries
    const validRecipients = [];
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
            status: 'QUEUED', // Changed from PENDING to QUEUED
            userId: req.user.id
          }
        });

        validRecipients.push({
          phoneNumber,
          smsId: smsLog.id
        });

        results.push({
          phoneNumber,
          status: 'QUEUED',
          smsId: smsLog.id
        });

      } catch (error) {
        logger.error(`Failed to create SMS log for ${phoneNumber}:`, error);
        results.push({
          phoneNumber,
          status: 'FAILED',
          error: 'Database error'
        });
      }
    }

    // Send response immediately after queuing all messages
    const queuedCount = validRecipients.length;
    const failedCount = results.filter(r => r.status === 'FAILED').length;

    logger.info(`Bulk SMS queued: ${queuedCount} messages queued, ${failedCount} failed validation`);

    res.json({
      message: 'Bulk SMS queued for processing',
      summary: {
        total: recipients.length,
        queued: queuedCount,
        failed: failedCount
      },
      results,
      note: 'Messages are being processed in background with 12-second intervals. Check status endpoint for updates.'
    });

    // Process messages in background without blocking the response
    setImmediate(async () => {
      logger.info(`Starting background processing of ${queuedCount} SMS messages with 12-second intervals`);
      
      for (let i = 0; i < validRecipients.length; i++) {
        const recipient = validRecipients[i];
        try {
          // Update status to PENDING before sending
          await prisma.smsLog.update({
            where: { id: recipient.smsId },
            data: { 
              status: 'PENDING',
              updatedAt: new Date()
            }
          });

          logger.info(`Processing SMS ${i + 1}/${queuedCount} to ${recipient.phoneNumber}`);

          // Send via MQTT - Arduino expects individual SMS
          const mqttMessage = `${recipient.phoneNumber}|${message}`;
          const success = await mqttService.publishMessage(mqttMessage);

          if (success) {
            await prisma.smsLog.update({
              where: { id: recipient.smsId },
              data: { 
                status: 'SENT',
                sentAt: new Date()
              }
            });
            logger.info(`✅ SMS sent to ${recipient.phoneNumber} (${i + 1}/${queuedCount})`);
          } else {
            await prisma.smsLog.update({
              where: { id: recipient.smsId },
              data: { 
                status: 'FAILED',
                errorMsg: 'Failed to publish to MQTT broker'
              }
            });
            logger.error(`❌ Failed to send SMS to ${recipient.phoneNumber} (${i + 1}/${queuedCount})`);
          }

          processedCount++;
          
          // Add 12-second delay between messages (except after the last one)
          if (i < validRecipients.length - 1) {
            logger.info(`⏳ Waiting 12 seconds before next SMS (${processedCount}/${queuedCount} completed)`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGES));
          }

        } catch (error) {
          logger.error(`Background processing error for ${recipient.phoneNumber}:`, error);
          try {
            await prisma.smsLog.update({
              where: { id: recipient.smsId },
              data: { 
                status: 'FAILED',
                errorMsg: 'Background processing error: ' + error.message
              }
            });
          } catch (dbError) {
            logger.error(`Failed to update SMS status in database:`, dbError);
          }
        }
      }

      logger.info(`🎉 Bulk SMS background processing completed: ${processedCount}/${queuedCount} processed successfully`);
    });

  } catch (error) {
    logger.error('Bulk SMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
