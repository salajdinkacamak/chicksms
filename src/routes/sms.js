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
      // Keep status as PENDING until Arduino confirms delivery
      logger.info(`SMS queued for sending: ${phoneNumber}`);
      
      res.json({
        message: 'SMS queued for sending',
        smsId: smsLog.id,
        status: 'PENDING',
        note: 'Status will update to SENT when Arduino confirms delivery'
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
          status: 'PENDING', // Reset to PENDING, will be updated by Arduino confirmation
          retryCount: smsLog.retryCount + 1,
          errorMsg: null
        }
      });

      logger.info(`SMS retry queued: ${smsLog.phoneNumber}`);
      
      res.json({
        message: 'SMS retry queued, waiting for Arduino confirmation',
        status: 'PENDING'
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
    const { recipients, message, delaySeconds } = req.body;

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
        error: 'Maximum 100 recipients allowed per bulk request to prevent overwhelming the system' 
      });
    }

    // Use custom delay if provided, otherwise use the default DELAY_BETWEEN_MESSAGES
    const delay = delaySeconds 
      ? Math.max(5, Math.min(delaySeconds, 60)) * 1000 // Min 5 sec, Max 60 sec if custom
      : DELAY_BETWEEN_MESSAGES; // Use default 20 seconds
    const results = [];
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;

    // Validate all phone numbers and create database entries
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
            status: 'QUEUED',
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

    const queuedCount = validRecipients.length;
    const failedCount = results.filter(r => r.status === 'FAILED').length;
    const estimatedDuration = Math.ceil((queuedCount * delay) / 1000 / 60); // in minutes

    logger.info(`Bulk SMS queued: ${queuedCount} messages, ${failedCount} failed, ${delay/1000}s delay, ~${estimatedDuration}min duration`);

    // Send immediate response
    res.json({
      message: 'Bulk SMS queued for background processing',
      summary: {
        total: recipients.length,
        queued: queuedCount,
        failed: failedCount,
        delayBetweenSMS: `${delay/1000} seconds`,
        estimatedDuration: `${estimatedDuration} minutes`
      },
      results,
      note: 'All SMS are being processed individually in background. Check status endpoint for real-time updates.'
    });

    // Start background thread for SMS processing
    processBulkSMSInBackground(validRecipients, message, delay);

  } catch (error) {
    logger.error('Bulk SMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Background SMS processing function
async function processBulkSMSInBackground(recipients, message, delay) {
  const startTime = new Date();
  const totalCount = recipients.length;
  
  logger.info(`🚀 Starting background SMS processing: ${totalCount} messages with ${delay/1000}s delays`);
  
  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    const currentNumber = i + 1;
    
    try {
      // Update status to PENDING
      await prisma.smsLog.update({
        where: { id: recipient.smsId },
        data: { 
          status: 'PENDING',
          updatedAt: new Date()
        }
      });

      logger.info(`📱 Processing SMS ${currentNumber}/${totalCount} to ${recipient.phoneNumber}`);

      // Send individual SMS via MQTT
      const mqttMessage = `${recipient.phoneNumber}|${message}`;
      const success = await mqttService.publishMessage(mqttMessage);

      if (success) {
        // Keep status as PENDING until Arduino confirms delivery
        logger.info(`✅ SMS ${currentNumber}/${totalCount} queued to ${recipient.phoneNumber} - waiting for Arduino confirmation`);
      } else {
        await prisma.smsLog.update({
          where: { id: recipient.smsId },
          data: { 
            status: 'FAILED',
            errorMsg: 'Failed to publish to MQTT broker'
          }
        });
        logger.error(`❌ SMS ${currentNumber}/${totalCount} failed for ${recipient.phoneNumber}`);
      }

      // Wait before next SMS (except for the last one)
      if (i < recipients.length - 1) {
        logger.info(`⏳ Waiting ${delay/1000}s before next SMS (${currentNumber}/${totalCount} completed)`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      logger.error(`💥 Error processing SMS ${currentNumber}/${totalCount} for ${recipient.phoneNumber}:`, error);
      
      try {
        await prisma.smsLog.update({
          where: { id: recipient.smsId },
          data: { 
            status: 'FAILED',
            errorMsg: `Processing error: ${error.message}`
          }
        });
      } catch (dbError) {
        logger.error(`Database update error for ${recipient.phoneNumber}:`, dbError);
      }
    }
  }

  const endTime = new Date();
  const totalDuration = Math.ceil((endTime - startTime) / 1000 / 60);
  
  logger.info(`🎉 Background SMS processing completed! ${totalCount} messages processed in ${totalDuration} minutes`);
}

module.exports = router;
