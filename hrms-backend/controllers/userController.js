import User from '../models/User.js';
import { logAction } from './auditController.js';
import { pool } from '../config/mysql.js';

export const getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    const activeUsers = users.filter(u => u.isActive);
    res.json(activeUsers);
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const createUser = async (req, res) => {
  try {
    const {
      name, username, email, role, department, password,
      aadhaarNumber, guardianName, mobileNumber, guardianMobileNumber,
      joiningDate, bonds, salaryBreakdown, paidLeaveAllocation
    } = req.body;
    const currentUser = req.user;

    if (!name || !username || !email || !role || !department) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (currentUser.role === 'HR') {
      if (role !== 'Employee') {
        return res.status(403).json({
          message: 'HR can only create Employee users'
        });
      }
    } else if (currentUser.role !== 'Admin') {
      return res.status(403).json({
        message: 'Only Admin and HR can create users'
      });
    }

    const userPassword = password && password.trim() !== '' ? password : 'tempPassword123';
    const isFirstLogin = !password || password.trim() === '';

    const user = new User({
      name,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      role,
      department,
      password: userPassword,
      isFirstLogin,
      isActive: true,
      aadhaarNumber: aadhaarNumber || null,
      guardianName: guardianName || null,
      mobileNumber: mobileNumber || null,
      guardianMobileNumber: guardianMobileNumber || null,
      joiningDate: joiningDate || null,
      bonds: bonds || [],
      salaryBreakdown: salaryBreakdown || []
    });

    if (paidLeaveAllocation !== undefined && paidLeaveAllocation !== null) {
      user.paidLeaveAllocation = paidLeaveAllocation;
      user.paidLeaveLastAllocatedDate = new Date();
    }

    await user.save();

    await logAction(
      currentUser.id || currentUser._id,
      currentUser.name,
      'CREATE_USER',
      'USER',
      user.id.toString(),
      `Created user ${user.username} with role ${user.role}`
    );

    res.status(201).json({
      message: 'User created successfully',
      user 
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    const users = await User.find({ role });
    const activeUsers = users.filter(u => u.isActive);
    res.json(activeUsers);
  } catch (error) {
    console.error('Get users by role error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user;
    const currentUserId = currentUser.id || currentUser._id;

    if (currentUser.role !== 'Admin') {
      return res.status(403).json({ message: 'Only Admin can delete users' });
    }

    if (currentUserId.toString() === id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.isActive = false;
    await user.save();

    await logAction(
      currentUserId,
      currentUser.name,
      'DELETE_USER',
      'USER',
      id,
      `Deleted user ${user.name} (${user.role})`
    );

    res.json({ message: `User ${user.name} deleted successfully` });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, department, password,
      aadhaarNumber, guardianName, mobileNumber, guardianMobileNumber,
      joiningDate, bonds, salaryBreakdown, paidLeaveAllocation
    } = req.body;
    const currentUser = req.user;

    if (currentUser.role !== 'Admin' && currentUser.role !== 'HR') {
      return res.status(403).json({ message: 'Only Admin and HR can update users' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (name !== undefined && name.trim() !== '') user.name = name.trim();
    if (email !== undefined && email.trim() !== '') user.email = email.trim().toLowerCase();
    if (department !== undefined && department.trim() !== '') user.department = department.trim();

    if (aadhaarNumber !== undefined) user.aadhaarNumber = aadhaarNumber;
    if (guardianName !== undefined) user.guardianName = guardianName;
    if (mobileNumber !== undefined) user.mobileNumber = mobileNumber;
    if (guardianMobileNumber !== undefined) user.guardianMobileNumber = guardianMobileNumber;
    if (joiningDate !== undefined) user.joiningDate = joiningDate;

    if (bonds !== undefined) user.bonds = bonds;
    if (salaryBreakdown !== undefined) user.salaryBreakdown = salaryBreakdown;

    if (paidLeaveAllocation !== undefined && paidLeaveAllocation !== null) {
      user.paidLeaveAllocation = paidLeaveAllocation;
      user.paidLeaveLastAllocatedDate = new Date();
    }

    if (password !== undefined && password.trim() !== '') {
      if (password.length < 4) {
        return res.status(400).json({ message: 'Password must be at least 4 characters' });
      }
      user.password = password; // Model.save() should hash this if it detects plain text
      user.isFirstLogin = false;
    }

    await user.save();

    await logAction(
      currentUser.id || currentUser._id,
      currentUser.name,
      'UPDATE_USER',
      'USER',
      id,
      `Updated user details for ${user.name}`
    );

    res.json({ message: 'User updated successfully', user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getEmployeeStats = async (req, res) => {
  try {
    // Custom logic since Model doesn't have it
    const users = await User.find({ role: 'Employee' }); // Filter logic inside find or filter after?
    // My User.find supports role query
    const activeEmployees = users.filter(u => u.isActive);

    // Group by department
    const departmentCounts = {};
    activeEmployees.forEach(u => {
      const dept = u.department || 'Unassigned';
      departmentCounts[dept] = (departmentCounts[dept] || 0) + 1;
    });

    const stats = {
      totalEmployees: activeEmployees.length,
      departmentCounts
    };

    res.json(stats);
  } catch (error) {
    console.error('Get employee stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const resetAllPaidLeaveAllocation = async (req, res) => {
  try {
    const currentUser = req.user;

    if (currentUser.role !== 'Admin') {
      return res.status(403).json({ message: 'Only Admin can reset all paid leave allocations' });
    }

    // Bulk update using pool
    const [result] = await pool.query('UPDATE users SET paid_leave_allocation = 0, paid_leave_last_allocated_date = NOW() WHERE role = ?', ['Employee']);
    const count = result.affectedRows;

    await logAction(
      currentUser.id || currentUser._id,
      currentUser.name,
      'RESET_ALL_PAID_LEAVE',
      'SYSTEM',
      'ALL',
      `Reset paid leave allocation to 0 for all employees (${count} users)`
    );

    res.json({
      message: `Successfully reset paid leave allocation to 0 for ${count} users`,
      count
    });
  } catch (error) {
    console.error('Reset all paid leave allocation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const markSalaryAsPaid = async (req, res) => {
  try {
    const { userId, month, year } = req.params;
    const { isPaid } = req.body;
    const currentUser = req.user;

    if (currentUser.role !== 'Admin' && currentUser.role !== 'HR') {
      return res.status(403).json({ message: 'Only Admin and HR can mark salary as paid' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // For now, just log the action (matches previous logic)
    await logAction(
      currentUser.id || currentUser._id,
      currentUser.name,
      isPaid ? 'MARK_SALARY_PAID' : 'UNMARK_SALARY_PAID',
      'USER',
      userId,
      `${isPaid ? 'Marked' : 'Unmarked'} salary as paid for ${user.name} - ${month}/${year}`
    );

    res.json({
      message: `Salary ${isPaid ? 'marked as paid' : 'unmarked'} successfully`
    });
  } catch (error) {
    console.error('Mark salary as paid error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
