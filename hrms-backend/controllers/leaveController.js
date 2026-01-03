import LeaveRequest from '../models/LeaveRequest.js';
import User from '../models/User.js';
import { logAction } from './auditController.js';
import { sendNotification } from './notificationController.js';
import { Op } from 'sequelize';

export const requestLeave = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate, category, reason, attachmentUrl, startTime } = req.body;
    let { endTime } = req.body;

    console.log('Leave request received:', { startDate, endDate, category, reason: reason?.substring(0, 50) });

    if (!startDate || !endDate || !category || !reason) {
      console.error('Missing required fields:', { startDate: !!startDate, endDate: !!endDate, category: !!category, reason: !!reason });
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Validate category
    const validCategories = ['Paid Leave', 'Unpaid Leave', 'Half Day Leave', 'Extra Time Leave'];
    if (!validCategories.includes(category)) {
      console.error('Invalid category:', category);
      return res.status(400).json({
        message: `Invalid leave category. Must be one of: ${validCategories.join(', ')}`,
        received: category
      });
    }

    // Validate time fields for extra time leave and half day leave
    if (category === 'Extra Time Leave') {
      if (!startTime || !endTime) {
        return res.status(400).json({
          message: 'Start time and end time are required for Extra Time Leave'
        });
      }
    } else if (category === 'Half Day Leave') {
      if (!startTime) {
        return res.status(400).json({
          message: 'Start time is required for Half Day Leave'
        });
      }
      // Calculate end time for half day leave if not provided (add 4 hours)
      if (!endTime && startTime) {
        const [hours, minutes] = startTime.split(':').map(Number);
        const startMinutes = hours * 60 + minutes;
        const endMinutes = startMinutes + 240; // 4 hours = 240 minutes
        const endHours = Math.floor(endMinutes / 60) % 24;
        const endMins = endMinutes % 60;
        endTime = `${String(endHours).padStart(2, '0')}:${String(endMins).padStart(2, '0')}`;
      }
    }

    const user = await User.findByPk(userId);
    if (!user) {
      console.error('User not found:', userId);
      return res.status(404).json({ message: 'User not found' });
    }

    let savedLeave;
    try {
      savedLeave = await LeaveRequest.create({
        userId,
        userName: user.name,
        startDate,
        endDate,
        category,
        reason,
        attachmentUrl: attachmentUrl || null,
        status: 'Pending',
        startTime: startTime || null,
        endTime: endTime || null
      });

      console.log('Leave request saved successfully:', savedLeave.id);
    } catch (saveError) {
      console.error('Leave request save error:', saveError);
      if (saveError.name === 'SequelizeValidationError') {
        const validationErrors = {};
        if (saveError.errors) {
          saveError.errors.forEach(err => {
            validationErrors[err.path] = err.message;
          });
        }
        return res.status(400).json({
          message: 'Validation error',
          error: saveError.message,
          details: validationErrors
        });
      }
      throw saveError;
    }

    // Send notifications (don't fail if notification fails)
    try {
      await sendNotification(userId, `Leave request submitted for ${startDate}`);
    } catch (notifError) {
      console.error('Notification error (non-fatal):', notifError);
    }

    // Notify HR/Admin (don't fail if notification fails)
    try {
      const targetRoles = (user.role === 'HR' || user.role === 'Admin') ? ['Admin'] : ['HR', 'Admin'];

      const approvers = await User.findAll({
        where: {
          role: { [Op.in]: targetRoles },
          isActive: true
        }
      });

      for (const approver of approvers) {
        if (approver.id.toString() !== userId.toString()) {
          try {
            await sendNotification(approver.id, `New leave request from ${user.name}`);
          } catch (notifError) {
            console.error(`Notification error for approver ${approver.id} (non-fatal):`, notifError);
          }
        }
      }
    } catch (notifError) {
      console.error('HR notification error (non-fatal):', notifError);
    }

    // Return the saved leave request
    res.status(201).json(savedLeave);
  } catch (error) {
    console.error('Request leave error:', error);

    // Return more detailed error message
    const errorMessage = error.message || 'Server error';

    res.status(500).json({
      message: `Server error: ${errorMessage}`,
      error: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

export const getMyLeaves = async (req, res) => {
  try {
    const userId = req.user.id;
    const leaves = await LeaveRequest.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']]
    });
    res.json(leaves);
  } catch (error) {
    console.error('Get my leaves error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getLeavesByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    // Verify the userId matches the authenticated user (employees can only see their own)
    // Or allow HR/Admin to see any user's leaves
    if (req.user.role !== 'HR' && req.user.role !== 'Admin' && req.user.id.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Unauthorized to view this user\'s leaves' });
    }

    const leaves = await LeaveRequest.findAll({
      where: { userId },
      include: [{
        model: User,
        as: 'user',
        attributes: ['name', 'username', 'email', 'department', 'role']
      }],
      order: [['createdAt', 'DESC']]
    });

    res.json(leaves);
  } catch (error) {
    console.error('Get leaves by userId error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getAllLeaves = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};

    const leaves = await LeaveRequest.findAll({
      where: query,
      include: [{
        model: User,
        as: 'user',
        attributes: ['name', 'username', 'email', 'department', 'role']
      }],
      order: [['createdAt', 'DESC']]
    });

    res.json(leaves);
  } catch (error) {
    console.error('Get all leaves error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, hrComment } = req.body;

    if (!['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const leaveRequest = await LeaveRequest.findByPk(id, {
      include: [{
        model: User,
        as: 'user',
        attributes: ['name', 'id']
      }]
    });

    if (!leaveRequest) {
      return res.status(404).json({ message: 'Leave request not found' });
    }

    const employeeName = leaveRequest.user?.name || 'Unknown';
    const startDate = leaveRequest.startDate;
    const endDate = leaveRequest.endDate;
    const category = leaveRequest.category;

    const beforeData = JSON.stringify({ status: leaveRequest.status, comment: leaveRequest.hrComment });

    leaveRequest.status = status;
    if (hrComment) leaveRequest.hrComment = hrComment;

    await leaveRequest.save();
    const afterData = JSON.stringify({ status: leaveRequest.status, comment: leaveRequest.hrComment });

    await logAction(
      req.user.id,
      req.user.name,
      'UPDATE_LEAVE',
      'LEAVE',
      id,
      `${status} ${category} leave for ${employeeName} (${startDate} to ${endDate}). Comment: ${hrComment || 'None'}`,
      beforeData,
      afterData
    );

    // Send notification to the user
    // leaveRequest.userId might be just ID if not populated, but we populated 'user' as 'user' object.
    // However, the column 'userId' in DB is an integer. 
    // Sequelize model instance has 'userId' property.
    await sendNotification(leaveRequest.userId, `Your leave request for ${startDate} was ${status}.`);

    res.json(leaveRequest);
  } catch (error) {
    console.error('Update leave status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getPendingLeaves = async (req, res) => {
  try {
    const userRole = req.user.role;
    let whereClause = { status: 'Pending' };

    // HR can only see employee requests
    if (userRole === 'HR') {
      const employees = await User.findAll({
        where: { role: 'Employee' },
        attributes: ['id']
      });
      const employeeIds = employees.map(e => e.id);
      whereClause.userId = { [Op.in]: employeeIds };
    }

    const leaves = await LeaveRequest.findAll({
      where: whereClause,
      include: [{
        model: User,
        as: 'user',
        attributes: ['name', 'username', 'email', 'department', 'role']
      }],
      order: [['createdAt', 'DESC']]
    });

    res.json(leaves);
  } catch (error) {
    console.error('Get pending leaves error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


// Define Associations
LeaveRequest.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(LeaveRequest, { foreignKey: 'userId' });
