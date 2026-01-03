import Attendance from '../models/Attendance.js';
import LeaveRequest from '../models/LeaveRequest.js';
import User from '../models/User.js';
import { calculateWorkedSeconds, getFlags, getTodayStr } from '../utils/attendanceUtils.js';
import { logAction } from './auditController.js';
import { Op } from 'sequelize';

export const clockIn = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = getTodayStr();

    // Check if already clocked in today
    const existing = await Attendance.findOne({ where: { userId, date: today } });
    if (existing) {
      return res.status(400).json({ message: 'Already clocked in today' });
    }

    const attendance = await Attendance.create({
      userId,
      date: today,
      checkIn: new Date(),
      location: req.body.location || 'Office',
      breaks: [],
      totalWorkedSeconds: 0,
      lowTimeFlag: false,
      extraTimeFlag: false
    });

    await logAction(req.user.id, req.user.name, 'CLOCK_IN', 'ATTENDANCE', attendance.id.toString(), `Clocked in at ${today}`);

    res.json(attendance);
  } catch (error) {
    console.error('Clock in error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const clockOut = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = getTodayStr();

    const attendance = await Attendance.findOne({ where: { userId, date: today } });
    if (!attendance || !attendance.checkIn) {
      return res.status(400).json({ message: 'No check-in record found for today' });
    }

    if (attendance.checkOut) {
      return res.status(400).json({ message: 'Already clocked out today' });
    }

    // Check for active break
    // attendance.breaks is a JSON array
    const breaks = attendance.breaks || [];
    const activeBreak = breaks.find(b => !b.end);
    if (activeBreak) {
      return res.status(400).json({ message: 'Please end your break before clocking out' });
    }

    attendance.checkOut = new Date();

    // We pass attendance object to helper. 
    // The helper expects breaks array and checkIn date.
    // attendance instance works fine as it has properties.
    const worked = calculateWorkedSeconds(attendance, attendance.checkOut.toISOString());

    // Check for half-day leave
    const hasHalfDay = await LeaveRequest.findOne({
      where: {
        userId,
        startDate: today,
        category: 'Half Day',
        status: 'Approved'
      }
    });

    const { lowTime, extraTime } = getFlags(worked, !!hasHalfDay);

    attendance.totalWorkedSeconds = worked;
    attendance.lowTimeFlag = lowTime;
    attendance.extraTimeFlag = extraTime;

    await attendance.save();
    await logAction(req.user.id, req.user.name, 'CLOCK_OUT', 'ATTENDANCE', attendance.id.toString(), `Clocked out at ${today}`);

    res.json(attendance);
  } catch (error) {
    console.error('Clock out error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const startBreak = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = getTodayStr();
    const { type = 'Standard', reason } = req.body;

    const attendance = await Attendance.findOne({ where: { userId, date: today } });
    if (!attendance || !attendance.checkIn || attendance.checkOut) {
      return res.status(400).json({ message: 'No active attendance record' });
    }

    // Check for active break
    let breaks = attendance.breaks ? [...attendance.breaks] : [];
    const activeBreak = breaks.find(b => !b.end);
    if (activeBreak) {
      return res.status(400).json({ message: 'Break already in progress' });
    }

    // Enforce only one standard break per day
    if (type === 'Standard') {
      const hasStandardBreak = breaks.some(b => b.type === 'Standard' && b.end);
      if (hasStandardBreak) {
        return res.status(400).json({ message: 'Standard break already taken today. Please use Extra Break for additional breaks.' });
      }
    }

    // Require reason for extra breaks
    if (type === 'Extra' && !reason) {
      return res.status(400).json({ message: 'Reason is required for extra breaks' });
    }

    const breakData = {
      start: new Date(),
      type
    };

    // Add reason only for extra breaks
    if (type === 'Extra' && reason) {
      breakData.reason = reason.trim();
    }

    breaks.push(breakData);

    // Update attendance
    attendance.breaks = breaks;
    attendance.changed('breaks', true);
    await attendance.save();

    res.json(attendance);
  } catch (error) {
    console.error('Start break error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const endBreak = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = getTodayStr();

    const attendance = await Attendance.findOne({ where: { userId, date: today } });
    if (!attendance) {
      return res.status(400).json({ message: 'No attendance record found' });
    }

    let breaks = attendance.breaks ? [...attendance.breaks] : [];
    const activeBreakIndex = breaks.findIndex(b => !b.end);

    if (activeBreakIndex === -1) {
      return res.status(400).json({ message: 'No active break found' });
    }

    // Need to modify object in array
    const activeBreak = { ...breaks[activeBreakIndex] };
    activeBreak.end = new Date();
    activeBreak.durationSeconds = Math.max(0, (new Date(activeBreak.end).getTime() - new Date(activeBreak.start).getTime()) / 1000);

    breaks[activeBreakIndex] = activeBreak;

    attendance.breaks = breaks;
    attendance.changed('breaks', true);
    await attendance.save();

    res.json(attendance);
  } catch (error) {
    console.error('End break error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getTodayAttendance = async (req, res) => {
  try {
    const userId = req.user.id;
    const today = getTodayStr();

    const attendance = await Attendance.findOne({ where: { userId, date: today } });
    res.json(attendance || null);
  } catch (error) {
    console.error('Get today attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getAttendanceHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;

    const whereClause = { userId };

    if (startDate || endDate) {
      whereClause.date = {};
      if (startDate) whereClause.date[Op.gte] = startDate;
      if (endDate) whereClause.date[Op.lte] = endDate;
    }

    const attendance = await Attendance.findAll({
      where: whereClause,
      order: [['date', 'DESC']],
      limit: 100
    });

    // Recalculate flags
    for (const record of attendance) {
      if (record.checkIn && record.checkOut && (record.lowTimeFlag === undefined || record.extraTimeFlag === undefined || record.lowTimeFlag === null || record.extraTimeFlag === null)) {
        const worked = calculateWorkedSeconds(record, record.checkOut.toISOString());

        // Check for half-day leave
        const hasHalfDay = await LeaveRequest.findOne({
          where: {
            userId: record.userId,
            startDate: record.date,
            category: 'Half Day',
            status: 'Approved'
          }
        });

        const flags = getFlags(worked, !!hasHalfDay);
        record.lowTimeFlag = flags.lowTime;
        record.extraTimeFlag = flags.extraTime;
        record.totalWorkedSeconds = worked;
        await record.save();
      }
    }

    res.json(attendance);
  } catch (error) {
    console.error('Get attendance history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Admin create or update attendance
export const adminCreateAttendance = async (req, res) => {
  try {
    const { userId, date, checkIn, checkOut, breakDurationMinutes, notes } = req.body;

    if (!userId || !date) {
      return res.status(400).json({ message: 'userId and date are required' });
    }

    // Check if record exists
    let attendance = await Attendance.findOne({ where: { userId, date } });

    if (attendance) {
      // Update existing record
      const beforeData = JSON.stringify(attendance.toJSON());

      // Parse time strings and combine with date
      const baseDate = new Date(date);

      if (checkIn) {
        // Handle time format like "09:00" or "09:00 AM"
        let timeStr = checkIn.trim();
        let hours, minutes;

        if (timeStr.includes('AM') || timeStr.includes('PM')) {
          // 12-hour format
          const [timePart, period] = timeStr.split(/\s*(AM|PM)/i);
          const [h, m] = timePart.split(':');
          hours = parseInt(h, 10);
          minutes = parseInt(m || '0', 10);

          if (period.toUpperCase() === 'PM' && hours !== 12) {
            hours += 12;
          } else if (period.toUpperCase() === 'AM' && hours === 12) {
            hours = 0;
          }
        } else {
          // 24-hour format
          const [h, m] = timeStr.split(':');
          hours = parseInt(h, 10);
          minutes = parseInt(m || '0', 10);
        }

        attendance.checkIn = new Date(baseDate);
        attendance.checkIn.setHours(hours, minutes, 0, 0);
      }

      if (checkOut) {
        let timeStr = checkOut.trim();
        let hours, minutes;

        if (timeStr.includes('AM') || timeStr.includes('PM')) {
          const [timePart, period] = timeStr.split(/\s*(AM|PM)/i);
          const [h, m] = timePart.split(':');
          hours = parseInt(h, 10);
          minutes = parseInt(m || '0', 10);

          if (period.toUpperCase() === 'PM' && hours !== 12) {
            hours += 12;
          } else if (period.toUpperCase() === 'AM' && hours === 12) {
            hours = 0;
          }
        } else {
          const [h, m] = timeStr.split(':');
          hours = parseInt(h, 10);
          minutes = parseInt(m || '0', 10);
        }

        attendance.checkOut = new Date(baseDate);
        attendance.checkOut.setHours(hours, minutes, 0, 0);
      }

      if (notes !== undefined) attendance.notes = notes;

      if (breakDurationMinutes !== undefined) {
        const startTime = attendance.checkIn ? attendance.checkIn.getTime() : Date.now();
        const breaks = [{
          start: new Date(startTime + 1000),
          end: new Date(startTime + 1000 + (breakDurationMinutes * 60 * 1000)),
          type: 'Standard',
          durationSeconds: breakDurationMinutes * 60
        }];
        attendance.breaks = breaks;
        attendance.changed('breaks', true);
      }

      if (attendance.checkIn && attendance.checkOut) {
        const worked = calculateWorkedSeconds(attendance);
        const hasHalfDay = await LeaveRequest.findOne({
          where: {
            userId: attendance.userId,
            startDate: attendance.date,
            category: 'Half Day',
            status: 'Approved'
          }
        });
        const flags = getFlags(worked, !!hasHalfDay);
        attendance.totalWorkedSeconds = worked;
        attendance.lowTimeFlag = flags.lowTime;
        attendance.extraTimeFlag = flags.extraTime;
      }

      await attendance.save();
      const afterData = JSON.stringify(attendance.toJSON());

      await logAction(
        req.user.id,
        req.user.name,
        'UPDATE_ATTENDANCE',
        'ATTENDANCE',
        attendance.id.toString(),
        `Modified attendance record for ${date}`,
        beforeData,
        afterData
      );

      return res.json(attendance);
    }

    // Create new record
    const baseDate = new Date(date);
    let checkInDate = null;
    let checkOutDate = null;

    if (checkIn) {
      let timeStr = checkIn.trim();
      let hours, minutes;

      if (timeStr.includes('AM') || timeStr.includes('PM')) {
        const [timePart, period] = timeStr.split(/\s*(AM|PM)/i);
        const [h, m] = timePart.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);

        if (period.toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
      } else {
        const [h, m] = timeStr.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);
      }

      checkInDate = new Date(baseDate);
      checkInDate.setHours(hours, minutes, 0, 0);
    }

    if (checkOut) {
      let timeStr = checkOut.trim();
      let hours, minutes;

      if (timeStr.includes('AM') || timeStr.includes('PM')) {
        const [timePart, period] = timeStr.split(/\s*(AM|PM)/i);
        const [h, m] = timePart.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);

        if (period.toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
      } else {
        const [h, m] = timeStr.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);
      }

      checkOutDate = new Date(baseDate);
      checkOutDate.setHours(hours, minutes, 0, 0);
    }

    const breaks = [];
    if (breakDurationMinutes && checkInDate) {
      breaks.push({
        start: new Date(checkInDate.getTime() + 1000),
        end: new Date(checkInDate.getTime() + 1000 + (breakDurationMinutes * 60 * 1000)),
        type: 'Standard',
        durationSeconds: breakDurationMinutes * 60
      });
    }

    attendance = await Attendance.create({
      userId,
      date,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      breaks,
      notes,
      totalWorkedSeconds: 0,
      lowTimeFlag: false,
      extraTimeFlag: false
    });

    if (checkInDate && checkOutDate) {
      const worked = calculateWorkedSeconds(attendance);
      const hasHalfDay = await LeaveRequest.findOne({
        where: {
          userId,
          startDate: date,
          category: 'Half Day',
          status: 'Approved'
        }
      });
      const flags = getFlags(worked, !!hasHalfDay);
      attendance.totalWorkedSeconds = worked;
      attendance.lowTimeFlag = flags.lowTime;
      attendance.extraTimeFlag = flags.extraTime;
      await attendance.save();
    }

    await logAction(
      req.user.id,
      req.user.name,
      'CREATE_ATTENDANCE',
      'ATTENDANCE',
      attendance.id.toString(),
      `Created attendance record for ${date}`
    );

    res.status(201).json(attendance);
  } catch (error) {
    console.error('Admin create attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const adminUpdateAttendance = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { checkIn, checkOut, breakDurationMinutes, notes } = req.body;

    const attendance = await Attendance.findByPk(recordId);
    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    const beforeData = JSON.stringify(attendance.toJSON());

    const baseDate = new Date(attendance.date);

    if (checkIn) {
      let timeStr = checkIn.trim();
      let hours, minutes;

      if (timeStr.includes('AM') || timeStr.includes('PM')) {
        const [timePart, period] = timeStr.split(/\s*(AM|PM)/i);
        const [h, m] = timePart.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);

        if (period.toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
      } else {
        const [h, m] = timeStr.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);
      }

      attendance.checkIn = new Date(baseDate);
      attendance.checkIn.setHours(hours, minutes, 0, 0);
    }

    if (checkOut) {
      let timeStr = checkOut.trim();
      let hours, minutes;

      if (timeStr.includes('AM') || timeStr.includes('PM')) {
        const [timePart, period] = timeStr.split(/\s*(AM|PM)/i);
        const [h, m] = timePart.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);

        if (period.toUpperCase() === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period.toUpperCase() === 'AM' && hours === 12) {
          hours = 0;
        }
      } else {
        const [h, m] = timeStr.split(':');
        hours = parseInt(h, 10);
        minutes = parseInt(m || '0', 10);
      }

      attendance.checkOut = new Date(baseDate);
      attendance.checkOut.setHours(hours, minutes, 0, 0);
    }

    if (notes !== undefined) attendance.notes = notes;

    // Override breaks if provided
    if (breakDurationMinutes !== undefined) {
      const startTime = attendance.checkIn ? attendance.checkIn.getTime() : Date.now();
      const breaks = [{
        start: new Date(startTime + 1000),
        end: new Date(startTime + 1000 + (breakDurationMinutes * 60 * 1000)),
        type: 'Standard',
        durationSeconds: breakDurationMinutes * 60
      }];
      attendance.breaks = breaks;
      attendance.changed('breaks', true);
    }

    if (attendance.checkIn && attendance.checkOut) {
      const worked = calculateWorkedSeconds(attendance);

      const hasHalfDay = await LeaveRequest.findOne({
        where: {
          userId: attendance.userId,
          startDate: attendance.date,
          category: 'Half Day',
          status: 'Approved'
        }
      });

      const flags = getFlags(worked, !!hasHalfDay);
      attendance.totalWorkedSeconds = worked;
      attendance.lowTimeFlag = flags.lowTime;
      attendance.extraTimeFlag = flags.extraTime;
    }

    await attendance.save();
    const afterData = JSON.stringify(attendance.toJSON());

    await logAction(
      req.user.id,
      req.user.name,
      'UPDATE_ATTENDANCE',
      'ATTENDANCE',
      recordId,
      `Modified attendance record for ${attendance.date}`,
      beforeData,
      afterData
    );

    res.json(attendance);
  } catch (error) {
    console.error('Admin update attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getAllAttendance = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const whereClause = {};
    if (startDate || endDate) {
      whereClause.date = {};
      if (startDate) whereClause.date[Op.gte] = startDate;
      if (endDate) whereClause.date[Op.lte] = endDate;
    }

    const attendance = await Attendance.findAll({
      where: whereClause,
      include: [{
        model: User,
        as: 'user', // Need to check association alias
        attributes: ['name', 'username', 'email', 'department', 'role']
      }],
      order: [['date', 'DESC']],
      limit: 1000
    });

    // Note: To make include work, I need to define associations in models/index.js or equivalent.
    // Since I haven't done that globally, I rely on model definitions having 'references'.
    // BUT Sequelize needs explicit Model.belongsTo(User, { foreignKey: 'userId', as: 'user' }) call.
    // I will add this logic to the bottom of this file or handle it.
    // OR I can fetch users manually if I want to avoid side effects of missing associations.
    // Given "Properly shift", I should set up associations.

    // Recalculate flags
    for (const record of attendance) {
      if (record.checkIn && record.checkOut && (record.lowTimeFlag === undefined || record.extraTimeFlag === undefined || record.lowTimeFlag === null || record.extraTimeFlag === null)) {
        const worked = calculateWorkedSeconds(record, record.checkOut.toISOString());

        const hasHalfDay = await LeaveRequest.findOne({
          where: {
            userId: record.userId,
            startDate: record.date,
            category: 'Half Day',
            status: 'Approved'
          }
        });

        const flags = getFlags(worked, !!hasHalfDay);
        record.lowTimeFlag = flags.lowTime;
        record.extraTimeFlag = flags.extraTime;
        record.totalWorkedSeconds = worked;
        await record.save();
      }
    }

    res.json(attendance);
  } catch (error) {
    console.error('Get all attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getTodayAllAttendance = async (req, res) => {
  try {
    const today = getTodayStr();
    const attendance = await Attendance.findAll({
      where: { date: today },
      include: [{
        model: User,
        as: 'user',
        attributes: ['name', 'username', 'email', 'department', 'role']
      }],
      order: [['checkIn', 'ASC']]
    });

    for (const record of attendance) {
      if (record.checkIn && record.checkOut && (record.lowTimeFlag === undefined || record.extraTimeFlag === undefined || record.lowTimeFlag === null || record.extraTimeFlag === null)) {
        const worked = calculateWorkedSeconds(record, record.checkOut.toISOString());

        const hasHalfDay = await LeaveRequest.findOne({
          where: {
            userId: record.userId,
            startDate: record.date,
            category: 'Half Day',
            status: 'Approved'
          }
        });

        const flags = getFlags(worked, !!hasHalfDay);
        record.lowTimeFlag = flags.lowTime;
        record.extraTimeFlag = flags.extraTime;
        record.totalWorkedSeconds = worked;
        await record.save();
      }
    }

    res.json(attendance);
  } catch (error) {
    console.error('Get today all attendance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Define association here if not globally defined
// This is a bit hacky but works if the models are imported
Attendance.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(Attendance, { foreignKey: 'userId' });
