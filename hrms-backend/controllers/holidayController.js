import CompanyHoliday from '../models/CompanyHoliday.js';
import User from '../models/User.js';
import { logAction } from './auditController.js';
import { sendNotification } from './notificationController.js';
import { Op } from 'sequelize';

// Helper function to parse date in different formats and convert to YYYY-MM-DD
const parseDate = (dateStr) => {
  let date;
  let day, month, year;

  // Check if it's DD-MM-YYYY or DD/MM/YYYY format (day and month are 1-2 digits)
  if (dateStr.match(/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/)) {
    const parts = dateStr.split(/[-/]/);
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
    date = new Date(year, month - 1, day);
  }
  // Check if it's YYYY-MM-DD format (year is 4 digits first)
  else if (dateStr.match(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/)) {
    const parts = dateStr.split(/[-/]/);
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
    date = new Date(year, month - 1, day);
  }
  else {
    date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      year = date.getFullYear();
      month = date.getMonth() + 1;
      day = date.getDate();
    }
  }

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }

  if (year === undefined || month === undefined || day === undefined) {
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }

  const yearStr = String(year);
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');

  return {
    dateObj: date,
    dateStr: `${yearStr}-${monthStr}-${dayStr}`,
    day: dayStr,
    month: monthStr,
    year: yearStr
  };
};

// Helper function to get all Sundays in a month
const getAllSundaysInMonth = (year, month) => {
  const sundays = [];
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);

  let currentDate = new Date(firstDay);
  const dayOfWeek = currentDate.getDay(); // 0 = Sunday
  const daysUntilSunday = (7 - dayOfWeek) % 7;

  if (daysUntilSunday === 0) {
    sundays.push(new Date(currentDate));
  } else {
    currentDate.setDate(currentDate.getDate() + daysUntilSunday);
  }

  while (currentDate <= lastDay) {
    sundays.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return sundays.map(date => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
};

export const addHoliday = async (req, res) => {
  try {
    const { date, description } = req.body;

    if (!date || !description) {
      return res.status(400).json({ message: 'Date and description are required' });
    }

    const { dateObj, dateStr, day, month, year } = parseDate(date);

    const dayNum = parseInt(day, 10);
    const monthNum = parseInt(month, 10);
    const yearNum = parseInt(year, 10);

    let holidaysAdded = [];
    let addedCount = 0;

    // Check if the date is the 1st of a month
    if (dayNum === 1) {
      console.log(`Detected 1st of month: ${yearNum}-${monthNum}, finding all Sundays...`);
      const sundays = getAllSundaysInMonth(yearNum, monthNum);

      for (const sundayDate of sundays) {
        try {
          const existing = await CompanyHoliday.findOne({ where: { date: sundayDate } });
          if (!existing) {
            await CompanyHoliday.create({
              date: sundayDate,
              description: 'Sunday',
              createdBy: req.user.id,
              createdByName: req.user.name,
              createdByRole: req.user.role
            });
            holidaysAdded.push(sundayDate);
            addedCount++;
          }
        } catch (error) {
          // Skip duplicates or other errors
          if (error.name !== 'SequelizeUniqueConstraintError') {
            console.error(`Error adding Sunday ${sundayDate}:`, error);
          }
        }
      }

      // Also add the original date if it's not a Sunday
      const isSunday = dateObj.getDay() === 0;
      if (!isSunday) {
        try {
          const existing = await CompanyHoliday.findOne({ where: { date: dateStr } });
          if (!existing) {
            await CompanyHoliday.create({
              date: dateStr,
              description,
              createdBy: req.user.id,
              createdByName: req.user.name,
              createdByRole: req.user.role
            });
            holidaysAdded.push(dateStr);
            addedCount++;
          }
        } catch (error) {
          if (error.name !== 'SequelizeUniqueConstraintError') throw error;
        }
      }

      if (addedCount > 0) {
        await logAction(
          req.user.id,
          req.user.name,
          'ADD_HOLIDAY',
          'SYSTEM',
          'MULTIPLE',
          `Added ${addedCount} holiday(s) for month ${monthNum}/${yearNum}: ${holidaysAdded.join(', ')}`,
          null,
          JSON.stringify({ dates: holidaysAdded, description: dayNum === 1 && isSunday ? 'Sunday' : description })
        );

        const users = await User.findAll({ where: { isActive: true } });
        for (const user of users) {
          await sendNotification(user.id, `Added ${addedCount} holiday(s) for ${monthNum}/${yearNum}: ${holidaysAdded.length} Sunday(s) added`);
        }
      }

      return res.status(201).json({
        message: `Added ${addedCount} holiday(s) for month ${monthNum}/${yearNum}`,
        holidays: holidaysAdded,
        count: addedCount
      });
    } else {
      // Normal holiday addition
      try {
        const holiday = await CompanyHoliday.create({
          date: dateStr,
          description,
          createdBy: req.user.id,
          createdByName: req.user.name,
          createdByRole: req.user.role
        });

        await logAction(
          req.user.id,
          req.user.name,
          'ADD_HOLIDAY',
          'SYSTEM',
          holiday.id.toString(),
          `Added holiday: ${description} on ${dateStr}`,
          null,
          JSON.stringify(holiday.toJSON())
        );

        const users = await User.findAll({ where: { isActive: true } });
        for (const user of users) {
          await sendNotification(user.id, `New company holiday added: ${description} (${dateStr})`);
        }

        return res.status(201).json(holiday);
      } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
          return res.status(400).json({ message: 'Holiday already exists for this date' });
        }
        throw error;
      }
    }
  } catch (error) {
    console.error('Add holiday error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const getHolidays = async (req, res) => {
  try {
    const holidays = await CompanyHoliday.findAll({
      order: [['date', 'ASC']]
    });
    // Association with User (creator) not explicitly set up but data is stored in createdByName/Role
    res.json(holidays);
  } catch (error) {
    console.error('Get holidays error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const holiday = await CompanyHoliday.findByPk(id);

    if (!holiday) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    await holiday.destroy();

    await logAction(
      req.user.id,
      req.user.name,
      'DELETE_HOLIDAY',
      'SYSTEM',
      id,
      `Deleted holiday: ${holiday.description}`
    );

    res.json({ message: 'Holiday deleted successfully' });
  } catch (error) {
    console.error('Delete holiday error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

export const autoAddSundaysForMonth = async (force = false, userInfo = null) => {
  try {
    const today = new Date();
    const dayOfMonth = today.getDate();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();

    if (!force && dayOfMonth !== 1) {
      return { added: 0, message: 'Today is not the 1st of the month, no Sundays to add. Use force mode to add anyway.' };
    }

    const sundays = getAllSundaysInMonth(year, month);
    console.log(`Found ${sundays.length} Sundays in ${month}/${year}:`, sundays);

    let addedCount = 0;
    const addedDates = [];

    for (const sundayDate of sundays) {
      try {
        const existing = await CompanyHoliday.findOne({ where: { date: sundayDate } });
        if (!existing) {
          await CompanyHoliday.create({
            date: sundayDate,
            description: 'Sunday',
            createdByName: 'System',
            createdByRole: 'Admin'
          });
          addedCount++;
          addedDates.push(sundayDate);
        }
      } catch (error) {
        if (error.name !== 'SequelizeUniqueConstraintError') {
          console.error(`Error adding Sunday ${sundayDate}:`, error);
        }
      }
    }

    if (addedCount > 0) {
      const users = await User.findAll({ where: { isActive: true } });
      const notificationMessage = force && userInfo
        ? `Manually added ${addedCount} Sunday(s) as holiday for ${month}/${year} by ${userInfo.name}`
        : `Automatically added ${addedCount} Sunday(s) as holiday for ${month}/${year}`;

      for (const user of users) {
        await sendNotification(user.id, notificationMessage);
      }

      await logAction(
        userInfo ? userInfo.id : null,
        userInfo ? userInfo.name : 'System',
        force ? 'MANUAL_ADD_SUNDAYS' : 'AUTO_ADD_SUNDAYS',
        'SYSTEM',
        'MONTHLY',
        force
          ? `Manually added ${addedCount} Sunday(s) for ${month}/${year}: ${addedDates.join(', ')}`
          : `Automatically added ${addedCount} Sunday(s) for ${month}/${year}: ${addedDates.join(', ')}`,
        null,
        JSON.stringify({ dates: addedDates, month, year, force })
      );
    }

    return {
      added: addedCount,
      dates: addedDates,
      message: addedCount > 0
        ? `Added ${addedCount} Sunday(s) as holiday for ${month}/${year}: ${addedDates.join(', ')}`
        : `All Sundays for ${month}/${year} already exist in database`
    };
  } catch (error) {
    console.error('Auto add Sundays for month error:', error);
    throw error;
  }
};

export const autoAddSundays = async () => {
  try {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 = Sunday

    if (dayOfWeek !== 6) {
      return { added: 0, message: 'Today is not Saturday, no Sundays to add' };
    }

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextSunday = new Date(tomorrow);
    nextSunday.setDate(nextSunday.getDate() + 7);

    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const tomorrowStr = formatDate(tomorrow);
    const nextSundayStr = formatDate(nextSunday);

    let addedCount = 0;
    const addedDates = [];

    const existingTomorrow = await CompanyHoliday.findOne({ where: { date: tomorrowStr } });
    if (!existingTomorrow) {
      await CompanyHoliday.create({
        date: tomorrowStr,
        description: 'Sunday',
        createdByName: 'System',
        createdByRole: 'Admin'
      });
      addedCount++;
      addedDates.push(tomorrowStr);
    }

    const existingNextSunday = await CompanyHoliday.findOne({ where: { date: nextSundayStr } });
    if (!existingNextSunday) {
      await CompanyHoliday.create({
        date: nextSundayStr,
        description: 'Sunday',
        createdByName: 'System',
        createdByRole: 'Admin'
      });
      addedCount++;
      addedDates.push(nextSundayStr);
    }

    return {
      added: addedCount,
      dates: addedDates,
      message: addedCount > 0
        ? `Added ${addedCount} Sunday(s) as holiday: ${addedDates.join(', ')}`
        : 'Sundays already exist in database'
    };
  } catch (error) {
    console.error('Auto add Sundays error:', error);
    throw error;
  }
};
