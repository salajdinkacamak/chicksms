const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');
const mqttService = require('../services/mqttService');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();
const DELAY_BETWEEN_MESSAGES = 45000; // 45 seconds - increased delay for Arduino stability during bulk operations
const MAX_BULK_REQUEST = 1000;

// Global queue management for Arduino-safe processing
let smsQueue = [];
let isProcessingQueue = false;
let queueProcessor = null;

/**
 * @swagger
 * /api/sms/send:
 *   post:
 *     summary: Send an SMS (queued for Arduino-safe processing)
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - message
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 example: '+1234567890'
 *               message:
 *                 type: string
 *                 example: 'Hello from ChickSMS!'
 *     responses:
 *       200:
 *         description: SMS added to queue
 *       400:
 *         description: Invalid input
 */
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
        status: 'QUEUED', // Use QUEUED status for queue system
        userId: req.user.id
      }
    });

    // Add to Arduino-safe queue instead of sending immediately
    addToSMSQueue(phoneNumber, message, smsLog.id);
    
    const queueStatus = getQueueStatus();
    
    logger.info(`SMS added to Arduino-safe queue: ${phoneNumber}`);
    
    res.json({
      message: 'SMS added to Arduino-safe queue',
      smsId: smsLog.id,
      status: 'QUEUED',
      queuePosition: queueStatus.queueSize,
      estimatedWaitTime: `${Math.ceil(queueStatus.estimatedWaitTime / 60)} minutes`,
      note: 'SMS will be sent to Arduino safely with proper delays'
    });

  } catch (error) {
    logger.error('Send SMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/sms/retry/{id}:
 *   post:
 *     summary: Retry sending a failed SMS
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: SMS log ID
 *     responses:
 *       200:
 *         description: SMS retry queued
 *       400:
 *         description: SMS already sent or retry limit reached
 *       404:
 *         description: SMS not found
 */
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

/**
 * @swagger
 * /api/sms/status/{id}:
 *   get:
 *     summary: Get the status of a specific SMS
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: SMS log ID
 *     responses:
 *       200:
 *         description: SMS status
 *       404:
 *         description: SMS not found
 */
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

/**
 * @swagger
 * /api/sms/bulk-status:
 *   get:
 *     summary: Get bulk SMS status summary for a user
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *         description: User ID (admin only)
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [1h, 24h, 7d]
 *         description: Timeframe for summary (default: 1h)
 *     responses:
 *       200:
 *         description: Bulk SMS status summary
 */
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

/**
 * @swagger
 * /api/sms/bulk:
 *   post:
 *     summary: Send bulk SMS (queued for Arduino-safe processing)
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recipients
 *               - message
 *             properties:
 *               recipients:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ['+1234567890', '+1987654321']
 *               message:
 *                 type: string
 *                 example: 'Bulk message!'
 *               delaySeconds:
 *                 type: integer
 *                 description: (Ignored, system uses safe delay)
 *     responses:
 *       200:
 *         description: Bulk SMS added to queue
 *       400:
 *         description: Invalid input
 */
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

    if (recipients.length > MAX_BULK_REQUEST) {
      return res.status(400).json({ 
        error: `Maximum ${MAX_BULK_REQUEST} recipients allowed per bulk request to prevent overwhelming the system` 
      });
    }

    // Arduino-safe bulk processing - no custom delays, use system queue
    const results = [];
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;

    // Validate all phone numbers and add to queue immediately
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
        // Create SMS log entry with QUEUED status
        const smsLog = await prisma.smsLog.create({
          data: {
            phoneNumber,
            message,
            status: 'QUEUED',
            userId: req.user.id
          }
        });

        // Add to Arduino-safe queue
        addToSMSQueue(phoneNumber, message, smsLog.id);

        results.push({
          phoneNumber,
          status: 'QUEUED',
          smsId: smsLog.id
        });

      } catch (error) {
        logger.error(`Failed to queue SMS for ${phoneNumber}:`, error);
        results.push({
          phoneNumber,
          status: 'FAILED',
          error: 'Database error'
        });
      }
    }

    const queuedCount = results.filter(r => r.status === 'QUEUED').length;
    const failedCount = results.filter(r => r.status === 'FAILED').length;
    const queueStatus = getQueueStatus();
    const estimatedDuration = Math.ceil((queueStatus.estimatedWaitTime + (queuedCount * DELAY_BETWEEN_MESSAGES / 1000)) / 60); // in minutes

    logger.info(`Bulk SMS added to Arduino-safe queue: ${queuedCount} messages, ${failedCount} failed`);

    // Send immediate response
    res.json({
      message: 'Bulk SMS added to Arduino-safe queue',
      summary: {
        total: recipients.length,
        queued: queuedCount,
        failed: failedCount,
        queuePosition: queueStatus.queueSize - queuedCount,
        safeDelayBetweenSMS: `${DELAY_BETWEEN_MESSAGES/1000} seconds`,
        estimatedDuration: `${estimatedDuration} minutes`
      },
      results,
      note: 'All SMS are queued for Arduino-safe processing with proper delays. Check status endpoint for real-time updates.'
    });

  } catch (error) {
    logger.error('Bulk SMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/sms/queue-status:
 *   get:
 *     summary: Get the current SMS queue status
 *     tags: [SMS]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Queue status
 */
router.get('/queue-status', authMiddleware, async (req, res) => {
  try {
    const queueStatus = getQueueStatus();
    
    // Get recent queued SMS for this user
    const queuedSMS = await prisma.smsLog.findMany({
      where: {
        userId: req.user.id,
        status: { in: ['QUEUED', 'PENDING'] }
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: {
        id: true,
        phoneNumber: true,
        status: true,
        createdAt: true,
        message: true
      }
    });

    res.json({
      queue: {
        size: queueStatus.queueSize,
        isProcessing: queueStatus.isProcessing,
        estimatedWaitTime: `${Math.ceil(queueStatus.estimatedWaitTime / 60)} minutes`,
        delayBetweenSMS: `${DELAY_BETWEEN_MESSAGES/1000} seconds`
      },
      yourQueuedSMS: queuedSMS,
      note: 'Arduino processes one SMS at a time with safe delays to prevent overload'
    });

  } catch (error) {
    logger.error('Get queue status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Arduino-Safe Queue Management System
async function initializeArduinoSafeQueue() {
  if (queueProcessor) {
    return; // Already initialized
  }
  
  logger.info('🔧 Initializing Arduino-safe SMS queue processor...');
  
  // Start the queue processor
  queueProcessor = setInterval(async () => {
    if (isProcessingQueue || smsQueue.length === 0) {
      return;
    }
    
    await processNextSMSInQueue();
  }, 5000); // Check queue every 5 seconds
  
  logger.info('✅ Arduino-safe SMS queue processor started');
}

async function processNextSMSInQueue() {
  if (isProcessingQueue || smsQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  const smsItem = smsQueue.shift();
  
  try {
    logger.info(`📱 Processing queued SMS ${smsItem.phone} (${smsQueue.length} remaining in queue)`);
    
    // Update status to PENDING
    await prisma.smsLog.update({
      where: { id: smsItem.smsId },
      data: { 
        status: 'PENDING',
        updatedAt: new Date()
      }
    });

    // Check MQTT connection health
    const connectionStatus = mqttService.getConnectionStatus();
    if (!connectionStatus.connected) {
      logger.warn('⚠️  MQTT not connected, re-queuing SMS');
      smsQueue.unshift(smsItem); // Put back at front of queue
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      isProcessingQueue = false;
      return;
    }

    // Send to Arduino with retry logic
    let success = false;
    let attempt = 0;
    const maxAttempts = 3;
    
    while (!success && attempt < maxAttempts) {
      attempt++;
      
      // Truncate message for Arduino memory safety
      const safeMessage = smsItem.message.substring(0, 140); // Limit to 140 chars
      const mqttMessage = `${smsItem.phone}|${safeMessage}`;
      
      success = await mqttService.publishMessage(mqttMessage);
      
      if (!success) {
        logger.warn(`⚠️  MQTT publish failed, attempt ${attempt}/${maxAttempts} for ${smsItem.phone}`);
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds before retry
        }
      }
    }

    if (success) {
      logger.info(`✅ SMS queued to Arduino for ${smsItem.phone} - waiting for confirmation`);
    } else {
      await prisma.smsLog.update({
        where: { id: smsItem.smsId },
        data: { 
          status: 'FAILED',
          errorMsg: 'Failed to send to Arduino after retries'
        }
      });
      logger.error(`❌ SMS failed for ${smsItem.phone} after ${maxAttempts} attempts`);
    }

    // Arduino-safe delay before processing next message
    logger.info(`⏳ Waiting ${DELAY_BETWEEN_MESSAGES/1000}s before next SMS (Arduino safety delay)`);
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_MESSAGES));

  } catch (error) {
    logger.error(`💥 Error processing queued SMS for ${smsItem.phone}:`, error);
    
    try {
      await prisma.smsLog.update({
        where: { id: smsItem.smsId },
        data: { 
          status: 'FAILED',
          errorMsg: `Queue processing error: ${error.message}`
        }
      });
    } catch (dbError) {
      logger.error(`Database update error for ${smsItem.phone}:`, dbError);
    }
  } finally {
    isProcessingQueue = false;
  }
}

function addToSMSQueue(phone, message, smsId) {
  smsQueue.push({
    phone,
    message,
    smsId,
    addedAt: new Date()
  });
  
  logger.info(`📥 Added SMS to queue for ${phone} (queue size: ${smsQueue.length})`);
  
  // Initialize queue processor if not already running
  if (!queueProcessor) {
    initializeArduinoSafeQueue();
  }
}

function getQueueStatus() {
  return {
    queueSize: smsQueue.length,
    isProcessing: isProcessingQueue,
    estimatedWaitTime: smsQueue.length * (DELAY_BETWEEN_MESSAGES / 1000) // in seconds
  };
}

// Initialize queue on module load
initializeArduinoSafeQueue();

module.exports = router;
