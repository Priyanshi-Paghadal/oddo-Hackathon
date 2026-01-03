import AuditLog from '../models/AuditLog.js';

export const logAction = async (actorId, actorName, action, targetType, targetId, details, beforeData = null, afterData = null) => {
  try {
    const log = new AuditLog({
      actorId,
      actorName,
      action,
      targetType,
      targetId,
      beforeData,
      afterData,  
      details
    });
    await log.save();
  } catch (error) {
    console.error('Error logging action:', error);
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const logs = await AuditLog.find({ limit: parseInt(limit) });

    res.json(logs);
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
