const express = require('express');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

// Get SMS logs with pagination and filtering
router.get('/sms', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      phoneNumber,
      startDate,
      endDate,
      userId
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause
    const where = {};
    
    if (status) {
      where.status = status.toUpperCase();
    }
    
    if (phoneNumber) {
      where.phoneNumber = {
        contains: phoneNumber
      };
    }
    
    if (userId) {
      where.userId = userId;
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // Get total count for pagination
    const total = await prisma.smsLog.count({ where });

    // Get SMS logs
    const smsLogs = await prisma.smsLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { username: true }
        }
      }
    });

    const totalPages = Math.ceil(total / take);

    res.json({
      logs: smsLogs,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRecords: total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    logger.error('Get SMS logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get incoming SMS logs
router.get('/incoming', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      phoneNumber,
      startDate,
      endDate,
      processed
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause
    const where = {};
    
    if (phoneNumber) {
      where.phoneNumber = {
        contains: phoneNumber
      };
    }
    
    if (processed !== undefined) {
      where.processed = processed === 'true';
    }
    
    if (startDate || endDate) {
      where.receivedAt = {};
      if (startDate) {
        where.receivedAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.receivedAt.lte = new Date(endDate);
      }
    }

    // Get total count for pagination
    const total = await prisma.incomingSms.count({ where });

    // Get incoming SMS
    const incomingSms = await prisma.incomingSms.findMany({
      where,
      skip,
      take,
      orderBy: { receivedAt: 'desc' }
    });

    const totalPages = Math.ceil(total / take);

    res.json({
      logs: incomingSms,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRecords: total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    logger.error('Get incoming SMS logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mark incoming SMS as processed
router.put('/incoming/:id/processed', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { processed = true } = req.body;

    const incomingSms = await prisma.incomingSms.update({
      where: { id },
      data: { processed: Boolean(processed) }
    });

    res.json({
      message: 'SMS processed status updated',
      sms: incomingSms
    });

  } catch (error) {
    logger.error('Update incoming SMS processed status error:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'SMS not found' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get failed SMS logs (for retry queue)
router.get('/failed', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      maxRetries = 3
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      status: 'FAILED',
      retryCount: {
        lt: parseInt(maxRetries)
      }
    };

    // Get total count for pagination
    const total = await prisma.smsLog.count({ where });

    // Get failed SMS logs
    const failedSms = await prisma.smsLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { username: true }
        }
      }
    });

    const totalPages = Math.ceil(total / take);

    res.json({
      logs: failedSms,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRecords: total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    logger.error('Get failed SMS logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get SMS statistics
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.query;

    // Build where clause for date range
    const where = {};
    if (userId) {
      where.userId = userId;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // Get SMS statistics
    const [
      totalSms,
      sentSms,
      failedSms,
      pendingSms,
      totalIncoming
    ] = await Promise.all([
      prisma.smsLog.count({ where }),
      prisma.smsLog.count({ where: { ...where, status: 'SENT' } }),
      prisma.smsLog.count({ where: { ...where, status: 'FAILED' } }),
      prisma.smsLog.count({ where: { ...where, status: 'PENDING' } }),
      prisma.incomingSms.count()
    ]);

    // Get SMS count by day for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyStats = await prisma.smsLog.groupBy({
      by: ['status'],
      where: {
        ...where,
        createdAt: {
          gte: sevenDaysAgo
        }
      },
      _count: true
    });

    // Get top phone numbers (most SMS sent to)
    const topRecipients = await prisma.smsLog.groupBy({
      by: ['phoneNumber'],
      where: {
        ...where,
        status: 'SENT'
      },
      _count: true,
      orderBy: {
        _count: {
          phoneNumber: 'desc'
        }
      },
      take: 10
    });

    res.json({
      summary: {
        total: totalSms,
        sent: sentSms,
        failed: failedSms,
        pending: pendingSms,
        successRate: totalSms > 0 ? ((sentSms / totalSms) * 100).toFixed(2) : 0
      },
      incoming: {
        total: totalIncoming
      },
      dailyStats,
      topRecipients: topRecipients.map(r => ({
        phoneNumber: r.phoneNumber,
        count: r._count
      }))
    });

  } catch (error) {
    logger.error('Get SMS statistics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get login attempt logs
router.get('/login-attempts', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      username,
      success,
      startDate,
      endDate
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where clause
    const where = {};
    
    if (username) {
      where.username = {
        contains: username
      };
    }
    
    if (success !== undefined) {
      where.success = success === 'true';
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // Get total count for pagination
    const total = await prisma.loginAttempt.count({ where });

    // Get login attempts
    const loginAttempts = await prisma.loginAttempt.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' }
    });

    const totalPages = Math.ceil(total / take);

    res.json({
      logs: loginAttempts,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalRecords: total,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });

  } catch (error) {
    logger.error('Get login attempts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
