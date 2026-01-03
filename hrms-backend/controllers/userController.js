import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import LeaveRequest from '../models/LeaveRequest.js';
import { calculateWorkedSeconds, getFlags } from '../utils/attendanceUtils.js';
import { logAction } from './auditController.js';
import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';

export const getAllUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { isActive: true },
      attributes: { exclude: ['password'] },
      order: [['name', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Helper function to convert date to dd-mm-yyyy format
const formatDateToDDMMYYYY = (dateStr) => {
  if (!dateStr) return undefined;
  try {
    // If date is in yyyy-mm-dd format (from HTML date input), convert to dd-mm-yyyy
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = dateStr.split('-');
      return `${day}-${month}-${year}`;
    } else if (dateStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
      // Already in dd-mm-yyyy format
      return dateStr;
    } else {
      // Try to parse as Date and convert to dd-mm-yyyy
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
      }
    }
  } catch (error) {
    // If conversion fails, use as is
    return dateStr;
  }
  return dateStr;
};

export const createUser = async (req, res) => {
  try {
    const { name, username, email, role, department, password, joiningDate, bonds, aadhaarNumber, guardianName, mobileNumber, guardianMobileNumber, salaryBreakdown } = req.body;
    const currentUser = req.user;

    // Convert dates to dd-mm-yyyy format if provided
    const formattedJoiningDate = formatDateToDDMMYYYY(joiningDate);

    // Process bonds array - calculate end dates
    let formattedBonds = [];
    if (bonds && Array.isArray(bonds) && bonds.length > 0) {
      formattedBonds = bonds.map((bond, index) => {
        const periodMonths = parseInt(bond.periodMonths) || 0;
        if (periodMonths === 0) return null;

        // Calculate bond dates using same logic as salary breakdown
        const parseDDMMYYYY = (dateStr) => {
          if (!dateStr) return null;
          const [day, month, year] = dateStr.split('-').map(Number);
          return new Date(year, month - 1, day);
        };

        const getMonthEndDate = (year, month) => {
          return new Date(year, month, 0);
        };

        let bondStartDate = bond.startDate || formattedJoiningDate;
        if (index > 0 && formattedBonds[index - 1]) {
          // Start from previous bond's end date + 1 day
          const prevEndDate = parseDDMMYYYY(formattedBonds[index - 1].endDate);
          if (prevEndDate) {
            prevEndDate.setDate(prevEndDate.getDate() + 1);
            bondStartDate = formatDateToDDMMYYYY(prevEndDate.toISOString().split('T')[0]);
          }
        }

        // Calculate end date: last day of the month after adding periodMonths
        const startDateObj = parseDDMMYYYY(bondStartDate);
        if (!startDateObj) return null;

        // Get the month and year for the end of the bond period
        const startMonth = startDateObj.getMonth();
        const startYear = startDateObj.getFullYear();

        // Calculate end month and year (subtract 1 because we want the last day of the month before the next period starts)
        const totalMonths = startMonth + periodMonths - 1;
        const endMonth = totalMonths % 12;
        const endYear = startYear + Math.floor(totalMonths / 12);

        // Get last day of the end month
        const endDateObj = getMonthEndDate(endYear, endMonth + 1);
        const bondEndDate = formatDateToDDMMYYYY(endDateObj.toISOString().split('T')[0]);

        return {
          type: bond.type || 'Job',
          periodMonths: periodMonths,
          startDate: bondStartDate,
          endDate: bondEndDate,
          order: index + 1
        };
      }).filter(bond => bond !== null);
    }

    // Process salary breakdown array
    let formattedSalaryBreakdown = [];
    if (salaryBreakdown && Array.isArray(salaryBreakdown) && salaryBreakdown.length > 0) {
      formattedSalaryBreakdown = salaryBreakdown.map(item => ({
        month: parseInt(item.month),
        year: parseInt(item.year),
        amount: parseFloat(item.amount) || 0,
        bondType: item.bondType,
        startDate: formatDateToDDMMYYYY(item.startDate),
        endDate: formatDateToDDMMYYYY(item.endDate),
        isPartialMonth: item.isPartialMonth || false
      }));
    }

    if (!name || !username || !email || !role || !department) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Role-based authorization
    if (currentUser.role === 'HR') {
      if (role !== 'Employee') {
        return res.status(403).json({
          message: 'HR can only create Employee users. Only Admin can create Admin and HR users.'
        });
      }
    } else if (currentUser.role !== 'Admin') {
      return res.status(403).json({
        message: 'Only Admin and HR can create users.'
      });
    }

    // Password is optional - if not provided, use temporary password
    const userPassword = password && password.trim() !== '' ? password : 'tempPassword123';
    const isFirstLogin = !password || password.trim() === '';

    try {
      const user = await User.create({
        name,
        username: username.toLowerCase(),
        email: email.toLowerCase(),
        role,
        department,
        password: userPassword,
        isFirstLogin: isFirstLogin,
        isActive: true,
        joiningDate: formattedJoiningDate,
        bonds: formattedBonds,
        salaryBreakdown: formattedSalaryBreakdown,
        aadhaarNumber: aadhaarNumber || null,
        guardianName: guardianName || null,
        mobileNumber: mobileNumber || null,
        guardianMobileNumber: guardianMobileNumber || null,
        paidLeaveAllocation: 0,
      });

      console.log('User created successfully');

      const userObj = user.toJSON();
      delete userObj.password;

      // Log action
      await logAction(
        currentUser.id, // Sequelize uses .id
        currentUser.name,
        'CREATE_USER',
        'USER',
        user.id.toString(),
        `Created user ${user.username} with role ${user.role}`,
        null,
        JSON.stringify(userObj)
      );

      res.status(201).json({
        message: 'User created successfully. Temporary password: tempPassword123',
        user: userObj
      });
    } catch (saveError) {
      if (saveError.name === 'SequelizeUniqueConstraintError') {
        // Handle duplicate
        return res.status(400).json({ message: 'Username or Email already exists' });
      } else {
        throw saveError;
      }
    }

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};


export const getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    const users = await User.findAll({
      where: { role, isActive: true },
      attributes: { exclude: ['password'] },
      order: [['name', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    console.error('Get users by role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;

    // Only Admin can delete users
    if (currentUser.role !== 'Admin') {
      return res.status(403).json({ message: 'Only Admin can delete users' });
    }

    // Prevent self-deletion
    if (currentUser.id.toString() === id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userName = user.name;
    const userRole = user.role;

    // Soft delete - set isActive to false
    user.isActive = false;
    await user.save();

    await logAction(
      currentUser.id,
      currentUser.name,
      'DELETE_USER',
      'USER',
      id,
      `Deleted user ${userName} (${userRole})`
    );

    res.json({ message: `User ${userName} deleted successfully` });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, department, paidLeaveAllocation, joiningDate, bonds, aadhaarNumber, guardianName, mobileNumber, guardianMobileNumber, salaryBreakdown, password } = req.body;
    const currentUser = req.user;

    // Only Admin and HR can update users
    if (currentUser.role !== 'Admin' && currentUser.role !== 'HR') {
      return res.status(403).json({ message: 'Only Admin and HR can update users' });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const beforeData = JSON.stringify({
      name: user.name,
      email: user.email,
      department: user.department,
      paidLeaveAllocation: user.paidLeaveAllocation,
      joiningDate: user.joiningDate,
      bonds: user.bonds,
      aadhaarNumber: user.aadhaarNumber,
      guardianName: user.guardianName,
      mobileNumber: user.mobileNumber
    });

    // Update name if provided
    if (name !== undefined && name.trim() !== '') {
      user.name = name.trim();
    }

    // Update password if provided
    if (password !== undefined && password.trim() !== '') {
      if (password.length < 4) {
        return res.status(400).json({ message: 'Password must be at least 4 characters' });
      }
      user.password = password; // Hook handles hashing
      user.isFirstLogin = false;
    }

    // Update email if provided
    if (email !== undefined && email.trim() !== '') {
      user.email = email.trim().toLowerCase();
    }

    // Update department if provided
    if (department !== undefined && department.trim() !== '') {
      user.department = department.trim();
    }

    // Update aadhaar number if provided
    if (aadhaarNumber !== undefined) {
      user.aadhaarNumber = aadhaarNumber.trim() || null;
    }

    // Update guardian name if provided
    if (guardianName !== undefined) {
      user.guardianName = guardianName.trim() || null;
    }

    // Update mobile number if provided
    if (mobileNumber !== undefined) {
      user.mobileNumber = mobileNumber.trim() || null;
    }

    // Update guardian mobile number if provided
    if (guardianMobileNumber !== undefined) {
      user.guardianMobileNumber = guardianMobileNumber.trim() || null;
    }

    // Update paid leave allocation - ADD to existing allocation
    if (paidLeaveAllocation !== undefined) {
      const allocation = parseInt(paidLeaveAllocation);
      if (isNaN(allocation) || allocation < 0) {
        return res.status(400).json({ message: 'Paid leave allocation must be a positive number' });
      }
      // Add to existing allocation (default to 0 if null/undefined)
      const currentAllocation = user.paidLeaveAllocation || 0;
      user.paidLeaveAllocation = currentAllocation + allocation;
      // Update last allocation date
      user.paidLeaveLastAllocatedDate = new Date();
    }

    // Update joining date if provided
    if (joiningDate !== undefined) {
      user.joiningDate = formatDateToDDMMYYYY(joiningDate);
    }

    // Update bonds if provided
    if (bonds !== undefined && Array.isArray(bonds)) {
      user.bonds = bonds.map((bond, index) => {
        const periodMonths = parseInt(bond.periodMonths) || 0;
        if (periodMonths === 0) return null;

        const parseDDMMYYYY = (dateStr) => {
          if (!dateStr) return null;
          const [day, month, year] = dateStr.split('-').map(Number);
          return new Date(year, month - 1, day);
        };

        const getMonthEndDate = (year, month) => {
          return new Date(year, month, 0);
        };

        let bondStartDate = formatDateToDDMMYYYY(bond.startDate) || user.joiningDate;

        if (index > 0 && user.bonds && user.bonds[index - 1]) {
          const prevEndDate = parseDDMMYYYY(user.bonds[index - 1].endDate);
          if (prevEndDate) {
            prevEndDate.setDate(prevEndDate.getDate() + 1);
            bondStartDate = formatDateToDDMMYYYY(prevEndDate.toISOString().split('T')[0]);
          }
        }

        const startDateObj = parseDDMMYYYY(bondStartDate);
        if (!startDateObj) return null;

        const startMonth = startDateObj.getMonth();
        const startYear = startDateObj.getFullYear();
        const totalMonths = startMonth + periodMonths - 1;
        const endMonth = totalMonths % 12;
        const endYear = startYear + Math.floor(totalMonths / 12);
        const endDateObj = getMonthEndDate(endYear, endMonth + 1);
        const bondEndDate = formatDateToDDMMYYYY(endDateObj.toISOString().split('T')[0]);

        return {
          type: bond.type || 'Job',
          periodMonths: periodMonths,
          startDate: bondStartDate,
          endDate: bondEndDate,
          order: index + 1
        };
      }).filter(bond => bond !== null);
    }

    // Update salary breakdown if provided
    if (salaryBreakdown !== undefined && Array.isArray(salaryBreakdown)) {
      user.salaryBreakdown = salaryBreakdown.map(item => {
        // Find existing entry to preserve payment status
        const existingEntry = user.salaryBreakdown ? user.salaryBreakdown.find(
          entry => entry.month === parseInt(item.month) && entry.year === parseInt(item.year)
        ) : null;

        return {
          month: parseInt(item.month),
          year: parseInt(item.year),
          amount: parseFloat(item.amount) || 0,
          bondType: item.bondType,
          startDate: formatDateToDDMMYYYY(item.startDate),
          endDate: formatDateToDDMMYYYY(item.endDate),
          isPartialMonth: item.isPartialMonth || false,
          // Preserve payment status from existing entry if available
          isPaid: existingEntry ? existingEntry.isPaid : false,
          paidAt: existingEntry ? existingEntry.paidAt : undefined,
          paidBy: existingEntry ? existingEntry.paidBy : undefined
        };
      });
    }

    await user.save();

    const afterData = JSON.stringify({
      name: user.name,
      email: user.email,
      department: user.department,
      paidLeaveAllocation: user.paidLeaveAllocation,
      joiningDate: user.joiningDate,
      bonds: user.bonds,
      aadhaarNumber: user.aadhaarNumber,
      guardianName: user.guardianName,
      mobileNumber: user.mobileNumber,
      guardianMobileNumber: user.guardianMobileNumber
    });

    await logAction(
      currentUser.id,
      currentUser.name,
      'UPDATE_USER',
      'USER',
      id,
      `Updated user details for ${user.name}`,
      beforeData,
      afterData
    );

    const userObj = user.toJSON();
    delete userObj.password;

    res.json({ message: 'User updated successfully', user: userObj });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Reset all employees' paid leave allocation to 0
export const resetAllPaidLeaveAllocation = async (req, res) => {
  try {
    const currentUser = req.user;

    // Only Admin can reset all allocations
    if (currentUser.role !== 'Admin') {
      return res.status(403).json({ message: 'Only Admin can reset all paid leave allocations' });
    }

    // Reset all employees' and HR's paidLeaveAllocation to 0
    const [updatedCount] = await User.update(
      { paidLeaveAllocation: 0 },
      {
        where: {
          role: { [Op.in]: ['Employee', 'HR'] },
          isActive: true
        }
      }
    );

    await logAction(
      currentUser.id,
      currentUser.name,
      'RESET_ALL_PAID_LEAVE',
      'SYSTEM',
      'ALL',
      `Reset paid leave allocation to 0 for all employees (${updatedCount} users)`
    );

    res.json({
      message: `Successfully reset paid leave allocation to 0 for ${updatedCount} users`,
      count: updatedCount
    });
  } catch (error) {
    console.error('Reset all paid leave allocation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getEmployeeStats = async (req, res) => {
  try {
    const employees = await User.findAll({
      where: { role: 'Employee', isActive: true },
      attributes: { exclude: ['password'] }
    });

    const stats = await Promise.all(employees.map(async (employee) => {
      const records = await Attendance.findAll({ where: { userId: employee.id } });

      // Recalculate flags for records that have checkIn and checkOut but might be missing flags
      for (const record of records) {
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

      const presentDays = records.length;
      const totalWorkedSeconds = records.reduce((acc, r) => acc + r.totalWorkedSeconds, 0);

      const lowTimeCount = records.filter(r => r.lowTimeFlag).length;
      const extraTimeCount = records.filter(r => r.extraTimeFlag).length;

      const leaves = await LeaveRequest.findAll({
        where: {
          userId: employee.id,
          status: 'Approved'
        }
      });

      const leaveBreakdown = {
        paid: leaves.filter(l => l.category === 'Paid Leave').length,
        unpaid: leaves.filter(l => l.category === 'Unpaid Leave').length,
        half: leaves.filter(l => l.category === 'Half Day Leave').length,
        extraTime: leaves.filter(l => l.category === 'Extra Time Leave').length,
        total: leaves.length
      };

      const allLeaves = await LeaveRequest.findAll({ where: { userId: employee.id } });

      return {
        user: {
          id: employee.id,
          name: employee.name,
          username: employee.username,
          email: employee.email,
          department: employee.department
        },
        presentDays,
        totalWorkedHours: (totalWorkedSeconds / 3600).toFixed(1),
        lowTimeCount,
        extraTimeCount,
        ...leaveBreakdown,
        records,
        allLeaves: allLeaves
      };
    }));

    res.json(stats);
  } catch (error) {
    console.error('Get employee stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Mark salary as paid for a specific month
export const markSalaryAsPaid = async (req, res) => {
  try {
    const { userId, month, year } = req.params;
    const { isPaid } = req.body;
    const currentUser = req.user;

    // Only Admin and HR can mark salary as paid
    if (currentUser.role !== 'Admin' && currentUser.role !== 'HR') {
      return res.status(403).json({ message: 'Only Admin and HR can mark salary as paid' });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }


    // NOTE: user.salaryBreakdown IS a JSON array properly parsed by Sequelize.
    let breakdown = user.salaryBreakdown ? [...user.salaryBreakdown] : [];

    const index = breakdown.findIndex(
      item => item.month === parseInt(month) && item.year === parseInt(year)
    );

    if (index === -1) {
      return res.status(404).json({ message: 'Salary entry not found for the specified month' });
    }

    const entry = { ...breakdown[index] };
    entry.isPaid = isPaid;

    if (isPaid) {
      entry.paidAt = new Date();
      entry.paidBy = currentUser.name;
    } else {
      entry.paidAt = undefined;
      entry.paidBy = undefined;
    }

    breakdown[index] = entry;

    // Important: We must re-assign to trigger update
    User.update({ salaryBreakdown: breakdown }, { where: { id: userId } });
    // Or:
    user.salaryBreakdown = breakdown;
    user.changed('salaryBreakdown', true); // explicit check for JSON updates often needed
    await user.save();

    // Log action
    await logAction(
      currentUser.id,
      currentUser.name,
      isPaid ? 'MARK_SALARY_PAID' : 'UNMARK_SALARY_PAID',
      'USER',
      userId,
      `${isPaid ? 'Marked' : 'Unmarked'} salary as paid for ${user.name} - ${month}/${year}`
    );

    res.json({
      message: `Salary ${isPaid ? 'marked as paid' : 'unmarked'} successfully`,
      salaryEntry: entry
    });
  } catch (error) {
    console.error('Mark salary as paid error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
