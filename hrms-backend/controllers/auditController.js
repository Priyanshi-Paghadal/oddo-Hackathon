import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';

export const logAction = async (actorId, actorName, action, targetType, targetId, details, beforeData = null, afterData = null) => {
  try {
    const auditLog = await AuditLog.create({
      actorId: actorId ? actorId : null,
      actorName,
      action,
      targetType,
      targetId: targetId ? targetId.toString() : null,
      beforeData: beforeData ? (typeof beforeData === 'string' ? beforeData : JSON.stringify(beforeData)) : null,
      afterData: afterData ? (typeof afterData === 'string' ? afterData : JSON.stringify(afterData)) : null,
      details
    });
  } catch (error) {
    console.error('Error logging action:', error);
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const logs = await AuditLog.findAll({
      // include: [{
      //   model: User,
      //   as: 'actor',
      //   attributes: ['name', 'username']
      // }],
      // Note: User model might not be associated with AuditLog yet.
      // Given simple logging, we store actorName directly, so association is optional but good.
      // For now, we rely on the stored actorName or just fetch raw logs.
      // But let's leave association out if not defined to prevent errors.
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    res.json(logs);
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
