import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import { Op } from 'sequelize';

export const exportAttendanceReport = async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;

    const whereClause = {};
    if (startDate || endDate) {
      whereClause.date = {};
      if (startDate) whereClause.date[Op.gte] = startDate;
      if (endDate) whereClause.date[Op.lte] = endDate;
    }

    const includeClause = {
      model: User,
      as: 'user',
      attributes: ['name', 'username', 'email', 'department'] // ID is always included
    };

    let attendance = await Attendance.findAll({
      where: whereClause,
      include: [includeClause],
      order: [['date', 'DESC']]
    });

    // Filter by department if provided
    if (department) {
      attendance = attendance.filter(a => a.user && a.user.department === department);
    }

    // Format data for CSV
    const csvData = attendance.map(a => {
      const user = a.user || {};
      const breaks = a.breaks || [];
      return {
        Date: a.date,
        EmployeeID: user.id || '',
        Name: user.name || 'Unknown',
        Department: user.department || '',
        Location: a.location || '',
        CheckIn: a.checkIn ? a.checkIn.toISOString() : '',
        CheckOut: a.checkOut ? a.checkOut.toISOString() : '',
        BreakCount: breaks.length,
        WorkedSeconds: a.totalWorkedSeconds,
        LowTime: a.lowTimeFlag ? 'Yes' : 'No',
        ExtraTime: a.extraTimeFlag ? 'Yes' : 'No',
        Notes: a.notes || ''
      };
    });

    res.json(csvData);
  } catch (error) {
    console.error('Export report error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
