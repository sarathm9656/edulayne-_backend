import Attendance from '../models/Attendance.js';
import User from '../models/user.model.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch_table.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Calculate attendance status based on duration and late rules
const calculateAttendanceStatus = (totalDurationSeconds, classStartTime, firstJoinTime) => {
  const MIN_PRESENT_DURATION = 10 * 60; // 10 minutes in seconds
  const LATE_JOIN_THRESHOLD = 5 * 60; // 5 minutes in seconds

  // Check if joined late
  if (firstJoinTime) {
    const timeDiff = Math.abs(firstJoinTime - classStartTime);
    if (timeDiff > LATE_JOIN_THRESHOLD * 1000) { // Convert to milliseconds
      if (totalDurationSeconds >= MIN_PRESENT_DURATION) {
        return 'late'; // Joined late but stayed enough time
      } else {
        return 'absent'; // Joined late but didn't stay enough time
      }
    }
  }

  // Check if stayed enough time
  if (totalDurationSeconds >= MIN_PRESENT_DURATION) {
    return 'present';
  } else {
    return 'absent';
  }
};

// Handle student joining a session
const handleStudentJoin = async (req, res) => {
  try {
    const { student_id, course_id, batch_id, class_start_time } = req.body;

    // Validate required fields
    if (!student_id || !course_id || !batch_id || !class_start_time) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: student_id, course_id, batch_id, class_start_time'
      });
    }

    // Check if student is enrolled in the course and batch
    const user = await User.findById(student_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const course = await Course.findById(course_id);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    const batch = await Batch.findById(batch_id);
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found'
      });
    }

    // Find or create attendance record for today
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of day

    let attendance = await Attendance.findOne({
      student_id,
      course_id,
      batch_id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) // End of day
      }
    });

    const joinTime = new Date();

    if (!attendance) {
      // Create new attendance record
      attendance = new Attendance({
        student_id,
        course_id,
        batch_id,
        date: new Date(),
        marked_by: req.user.user_id || req.user._id, // Use Profile ID if available
        class_start_time: new Date(class_start_time),
        sessions: [{
          join_time: joinTime,
          leave_time: null,
          duration_seconds: 0
        }]
      });
    } else {
      // Add new session to existing record
      attendance.sessions.push({
        join_time: joinTime,
        leave_time: null,
        duration_seconds: 0
      });
    }

    await attendance.save();

    res.status(200).json({
      success: true,
      message: 'Student joined session successfully',
      data: attendance
    });
  } catch (error) {
    console.error('Error handling student join:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Handle student leaving a session
const handleStudentLeave = async (req, res) => {
  try {
    const { student_id, course_id, batch_id } = req.body;

    if (!student_id || !course_id || !batch_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: student_id, course_id, batch_id'
      });
    }

    const leaveTime = new Date();

    // Find today's attendance record
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      student_id,
      course_id,
      batch_id,
      date: {
        $gte: today,
        $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      }
    }).populate('sessions');

    if (!attendance) {
      return res.status(404).json({
        success: false,
        message: 'Attendance record not found for today'
      });
    }

    // Find the active session (without leave_time)
    const activeSession = attendance.sessions.find(session => !session.leave_time);

    if (!activeSession) {
      return res.status(400).json({
        success: false,
        message: 'No active session found for this student'
      });
    }

    // Update the session with leave time
    activeSession.leave_time = leaveTime;

    // Calculate duration for this session
    const durationMs = leaveTime.getTime() - activeSession.join_time.getTime();
    activeSession.duration_seconds = Math.floor(durationMs / 1000);

    // Calculate total duration across all sessions
    const totalDuration = attendance.sessions.reduce((total, session) => {
      return total + (session.duration_seconds || 0);
    }, 0);

    attendance.total_duration_seconds = totalDuration;

    // Calculate attendance status
    const firstJoinTime = attendance.sessions.length > 0 ?
      attendance.sessions[0].join_time : null;

    attendance.status = calculateAttendanceStatus(
      totalDuration,
      attendance.class_start_time,
      firstJoinTime
    );

    await attendance.save();

    res.status(200).json({
      success: true,
      message: 'Student left session successfully',
      data: attendance
    });
  } catch (error) {
    console.error('Error handling student leave:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get daily attendance summary
const getDailyAttendance = async (req, res) => {
  try {
    const { date, batch_id, course_id } = req.query;

    let queryDate = new Date();
    if (date) {
      queryDate = new Date(date);
    }

    // Normalize to start of day
    queryDate.setHours(0, 0, 0, 0);

    let query = {
      date: {
        $gte: queryDate,
        $lt: new Date(queryDate.getTime() + 24 * 60 * 60 * 1000)
      }
    };

    if (batch_id) {
      query.batch_id = batch_id;
    }

    if (course_id) {
      query.course_id = course_id;
    }

    const attendanceRecords = await Attendance.find(query)
      .populate('student_id', 'fname lname email')
      .populate('course_id', 'course_title')
      .populate('batch_id', 'batch_name')
      .populate('marked_by', 'fname lname email');

    // Calculate statistics
    const presentCount = attendanceRecords.filter(record => record.status === 'present').length;
    const lateCount = attendanceRecords.filter(record => record.status === 'late').length;
    const absentCount = attendanceRecords.filter(record => record.status === 'absent').length;

    res.status(200).json({
      success: true,
      data: {
        records: attendanceRecords,
        summary: {
          total: attendanceRecords.length,
          present: presentCount,
          late: lateCount,
          absent: absentCount,
          attendance_rate: attendanceRecords.length > 0
            ? ((presentCount + lateCount) / attendanceRecords.length) * 100
            : 0
        }
      }
    });
  } catch (error) {
    console.error('Error getting daily attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get monthly attendance summary for a student or all students in a course/batch
const getMonthlyAttendance = async (req, res) => {
  try {
    const { student_id, course_id, batch_id, month, year } = req.query;

    // Only course_id, month, and year are required for the query
    if (!course_id || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: course_id, month, year'
      });
    }

    const startDate = new Date(year, parseInt(month) - 1, 1);
    const endDate = new Date(year, parseInt(month), 0); // Last day of month
    endDate.setHours(23, 59, 59, 999);

    let query = {
      course_id,
      date: {
        $gte: startDate,
        $lte: endDate
      }
    };

    // If batch_id is provided, add it to the query
    if (batch_id) {
      query.batch_id = batch_id;
    }

    // If student_id is provided and not empty, get specific student's data
    if (student_id && student_id.trim() !== '') {
      query.student_id = student_id;

      const attendanceRecords = await Attendance.find(query)
        .populate('student_id', 'fname lname email')
        .populate('course_id', 'course_title')
        .populate('batch_id', 'batch_name');

      // Calculate monthly statistics for the specific student
      const presentCount = attendanceRecords.filter(record => record.status === 'present').length;
      const lateCount = attendanceRecords.filter(record => record.status === 'late').length;
      const absentCount = attendanceRecords.filter(record => record.status === 'absent').length;
      const totalCount = attendanceRecords.length;

      const attendancePercentage = totalCount > 0
        ? ((presentCount + lateCount) / totalCount) * 100
        : 0;

      // Calculate average duration
      const totalDuration = attendanceRecords.reduce((sum, record) => sum + record.total_duration_seconds, 0);
      const avgDuration = totalCount > 0 ? totalDuration / totalCount : 0;

      res.status(200).json({
        success: true,
        data: {
          records: attendanceRecords,
          summary: {
            total_classes: totalCount,
            attended: presentCount + lateCount,
            present: presentCount,
            late: lateCount,
            absent: absentCount,
            attendance_percentage: parseFloat(attendancePercentage.toFixed(2)),
            average_duration_seconds: Math.round(avgDuration),
            average_duration_minutes: Math.round(avgDuration / 60)
          }
        }
      });
    } else {
      // Get all students' data for the course/batch
      const attendanceRecords = await Attendance.find(query)
        .populate('student_id', 'fname lname email user_code')
        .populate('course_id', 'course_title')
        .populate('batch_id', 'batch_name');

      // If no records found, return empty arrays
      if (!attendanceRecords || attendanceRecords.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            students: [],
            summary: {
              total_students: 0,
              total_classes: 0,
              total_attended: 0,
              total_present: 0,
              total_late: 0,
              total_absent: 0,
              average_attendance_percentage: 0
            }
          }
        });
      }

      // Group by student
      const groupedByStudent = {};
      attendanceRecords.forEach(record => {
        if (!record.student_id) return; // Skip if student not found or population failed
        const studentId = record.student_id._id.toString();

        if (!groupedByStudent[studentId]) {
          groupedByStudent[studentId] = {
            student: record.student_id,
            records: []
          };
        }

        groupedByStudent[studentId].records.push(record);
      });

      // Calculate statistics for each student
      Object.keys(groupedByStudent).forEach(studentId => {
        const records = groupedByStudent[studentId].records;
        const presentCount = records.filter(r => r.status === 'present').length;
        const lateCount = records.filter(r => r.status === 'late').length;
        const absentCount = records.filter(r => r.status === 'absent').length;
        const totalCount = records.length;

        groupedByStudent[studentId].summary = {
          total_classes: totalCount,
          attended: presentCount + lateCount,
          present: presentCount,
          late: lateCount,
          absent: absentCount,
          attendance_percentage: totalCount > 0
            ? parseFloat(((presentCount + lateCount) / totalCount * 100).toFixed(2))
            : 0
        };
      });

      // Calculate overall summary
      // Calculate overall summary
      const allStudents = Object.values(groupedByStudent);
      const totalClasses = allStudents.reduce((sum, student) => sum + student.summary.total_classes, 0);
      const totalAttended = allStudents.reduce((sum, student) => sum + student.summary.attended, 0);
      const totalPresent = allStudents.reduce((sum, student) => sum + student.summary.present, 0);
      const totalLate = allStudents.reduce((sum, student) => sum + student.summary.late, 0);
      const totalAbsent = allStudents.reduce((sum, student) => sum + student.summary.absent, 0);
      const avgAttendance = allStudents.length > 0
        ? (allStudents.reduce((sum, student) => sum + student.summary.attendance_percentage, 0) / allStudents.length)
        : 0;

      res.status(200).json({
        success: true,
        data: {
          students: Object.values(groupedByStudent),
          summary: {
            total_students: allStudents.length,
            total_classes: totalClasses,
            total_attended: totalAttended,
            total_present: totalPresent,
            total_late: totalLate,
            total_absent: totalAbsent,
            average_attendance_percentage: parseFloat(avgAttendance.toFixed(2))
          }
        }
      });
    }
  } catch (error) {
    console.error('Error getting monthly attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get attendance by course and batch
const getAttendanceByCourseAndBatch = async (req, res) => {
  try {
    const { course_id, batch_id, start_date, end_date } = req.query;

    if (!course_id || !batch_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: course_id, batch_id'
      });
    }

    let query = {
      course_id,
      batch_id
    };

    if (start_date && end_date) {
      query.date = {
        $gte: new Date(start_date),
        $lte: new Date(end_date)
      };
    }

    const attendanceRecords = await Attendance.find(query)
      .populate('student_id', 'fname lname email user_code')
      .populate('course_id', 'course_title')
      .populate('batch_id', 'batch_name');

    // Group by student
    const groupedByStudent = {};
    attendanceRecords.forEach(record => {
      if (!record.student_id) return;
      const studentId = record.student_id._id.toString();

      if (!groupedByStudent[studentId]) {
        groupedByStudent[studentId] = {
          student: record.student_id,
          records: []
        };
      }

      groupedByStudent[studentId].records.push(record);
    });

    // Calculate statistics for each student
    Object.keys(groupedByStudent).forEach(studentId => {
      const records = groupedByStudent[studentId].records;
      const presentCount = records.filter(r => r.status === 'present').length;
      const lateCount = records.filter(r => r.status === 'late').length;
      const absentCount = records.filter(r => r.status === 'absent').length;
      const totalCount = records.length;

      groupedByStudent[studentId].summary = {
        total_classes: totalCount,
        attended: presentCount + lateCount,
        present: presentCount,
        late: lateCount,
        absent: absentCount,
        attendance_percentage: totalCount > 0
          ? parseFloat(((presentCount + lateCount) / totalCount * 100).toFixed(2))
          : 0
      };
    });

    res.status(200).json({
      success: true,
      data: {
        students: Object.values(groupedByStudent),
        total_records: attendanceRecords.length
      }
    });
  } catch (error) {
    console.error('Error getting attendance by course and batch:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Generate Daily Attendance PDF
const generateDailyAttendancePDF = async (req, res) => {
  try {
    const { date, course_id, batch_id } = req.query;

    if (!date || !course_id || !batch_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: date, course_id, batch_id'
      });
    }

    // Fetch attendance records for the specified date, course, and batch
    const queryDate = new Date(date);
    queryDate.setHours(0, 0, 0, 0);

    const endDate = new Date(queryDate);
    endDate.setDate(endDate.getDate() + 1);

    const attendanceRecords = await Attendance.find({
      course_id,
      batch_id,
      date: {
        $gte: queryDate,
        $lt: endDate
      }
    })
      .populate('student_id', 'fname lname email')
      .populate('course_id', 'course_title')
      .populate('batch_id', 'batch_name')
      .populate('marked_by', 'fname lname');

    if (!attendanceRecords || attendanceRecords.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No attendance records found for the specified criteria'
      });
    }

    // Get course and batch details
    const course = await Course.findById(course_id);
    const batch = await Batch.findById(batch_id);
    const instructor = await User.findById(attendanceRecords[0].marked_by._id);

    // Create PDF document
    const doc = new PDFDocument();
    const filename = `daily-attendance-${date.replace(/-/g, '')}-${course_id}.pdf`;
    const filePath = path.join(__dirname, '..', 'uploads', 'pdfs', filename);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Add header
    doc.fontSize(20).text('Daily Attendance Report', 50, 50);
    doc.moveDown();

    // Add report details
    doc.fontSize(12);
    doc.text(`Date: ${new Date(date).toLocaleDateString()}`, 50, doc.y);
    doc.text(`Course: ${course.course_title}`, 50, doc.y);
    doc.text(`Batch: ${batch.batch_name}`, 50, doc.y);
    doc.text(`Instructor: ${instructor.fname} ${instructor.lname}`, 50, doc.y);
    doc.moveDown(2);

    // Define table headers
    const headers = ['Student Name', 'Status', 'Duration (min)', 'Remarks'];
    const cellPadding = 10;
    const rowHeight = 30;
    const tableTop = doc.y;
    const colWidths = [150, 100, 100, 200];
    const startX = 50;

    // Draw table headers
    let currentX = startX;
    headers.forEach((header, index) => {
      doc.rect(currentX, tableTop, colWidths[index], rowHeight).stroke();
      doc.text(header, currentX + cellPadding, tableTop + (rowHeight - 12) / 2, { width: colWidths[index] - 2 * cellPadding });
      currentX += colWidths[index];
    });

    // Draw table rows
    let currentY = tableTop + rowHeight;
    attendanceRecords.forEach(record => {
      currentX = startX;

      // Student name
      doc.rect(currentX, currentY, colWidths[0], rowHeight).stroke();
      doc.text(`${record.student_id.fname} ${record.student_id.lname}`,
        currentX + cellPadding, currentY + (rowHeight - 12) / 2,
        { width: colWidths[0] - 2 * cellPadding });
      currentX += colWidths[0];

      // Status
      doc.rect(currentX, currentY, colWidths[1], rowHeight).stroke();
      doc.text(record.status.charAt(0).toUpperCase() + record.status.slice(1),
        currentX + cellPadding, currentY + (rowHeight - 12) / 2,
        { width: colWidths[1] - 2 * cellPadding });
      currentX += colWidths[1];

      // Duration
      doc.rect(currentX, currentY, colWidths[2], rowHeight).stroke();
      doc.text(Math.round(record.total_duration_seconds / 60) + ' min',
        currentX + cellPadding, currentY + (rowHeight - 12) / 2,
        { width: colWidths[2] - 2 * cellPadding });
      currentX += colWidths[2];

      // Remarks
      doc.rect(currentX, currentY, colWidths[3], rowHeight).stroke();
      doc.text(record.remarks || '-',
        currentX + cellPadding, currentY + (rowHeight - 12) / 2,
        { width: colWidths[3] - 2 * cellPadding });

      currentY += rowHeight;

      // Check if we need a new page
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }
    });

    // Add summary
    const presentCount = attendanceRecords.filter(r => r.status === 'present').length;
    const lateCount = attendanceRecords.filter(r => r.status === 'late').length;
    const absentCount = attendanceRecords.filter(r => r.status === 'absent').length;

    doc.moveDown(2);
    doc.text(`Summary: Total: ${attendanceRecords.length}, Present: ${presentCount}, Late: ${lateCount}, Absent: ${absentCount}`, 50, doc.y);

    // Finalize PDF
    doc.end();

    // Wait for the stream to finish
    writeStream.on('finish', () => {
      // Send the PDF file as response
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      fs.createReadStream(filePath).pipe(res);
    });

  } catch (error) {
    console.error('Error generating daily attendance PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Generate Monthly Attendance PDF
const generateMonthlyAttendancePDF = async (req, res) => {
  try {
    const { course_id, batch_id, month, year } = req.query;

    if (!course_id || !batch_id || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: course_id, batch_id, month, year'
      });
    }

    const startDate = new Date(year, parseInt(month) - 1, 1);
    const endDate = new Date(year, parseInt(month), 0); // Last day of month
    endDate.setHours(23, 59, 59, 999);

    // Query to get all attendance records for the month
    const attendanceRecords = await Attendance.find({
      course_id,
      batch_id,
      date: {
        $gte: startDate,
        $lte: endDate
      }
    })
      .populate('student_id', 'fname lname email user_code')
      .populate('course_id', 'course_title')
      .populate('batch_id', 'batch_name');

    if (!attendanceRecords || attendanceRecords.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No attendance records found for the specified criteria'
      });
    }

    // Group by student
    const groupedByStudent = {};
    attendanceRecords.forEach(record => {
      const studentId = record.student_id._id.toString();

      if (!groupedByStudent[studentId]) {
        groupedByStudent[studentId] = {
          student: record.student_id,
          records: []
        };
      }

      groupedByStudent[studentId].records.push(record);
    });

    // Calculate statistics for each student
    Object.keys(groupedByStudent).forEach(studentId => {
      const records = groupedByStudent[studentId].records;
      const presentCount = records.filter(r => r.status === 'present').length;
      const lateCount = records.filter(r => r.status === 'late').length;
      const absentCount = records.filter(r => r.status === 'absent').length;
      const totalCount = records.length;

      groupedByStudent[studentId].summary = {
        total_classes: totalCount,
        attended: presentCount + lateCount,
        present: presentCount,
        late: lateCount,
        absent: absentCount,
        attendance_percentage: totalCount > 0
          ? parseFloat(((presentCount + lateCount) / totalCount * 100).toFixed(2))
          : 0
      };
    });

    // Get course and batch details
    const course = await Course.findById(course_id);
    const batch = await Batch.findById(batch_id);

    // Create PDF document
    const doc = new PDFDocument();
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const filename = `monthly-attendance-${month}-${year}-${course_id}.pdf`;
    const filePath = path.join(__dirname, '..', 'uploads', 'pdfs', filename);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Add header
    doc.fontSize(20).text('Monthly Attendance Report', 50, 50);
    doc.moveDown();

    // Add report details
    doc.fontSize(12);
    doc.text(`Month: ${monthNames[parseInt(month) - 1]} ${year}`, 50, doc.y);
    doc.text(`Course: ${course.course_title}`, 50, doc.y);
    doc.text(`Batch: ${batch.batch_name}`, 50, doc.y);
    doc.moveDown(2);

    // Define table headers
    const headers = ['Student Name', 'Total Classes', 'Classes Attended', 'Attendance %'];
    const cellPadding = 10;
    const rowHeight = 30;
    const tableTop = doc.y;
    const colWidths = [180, 100, 120, 100];
    const startX = 50;

    // Draw table headers
    let currentX = startX;
    headers.forEach((header, index) => {
      doc.rect(currentX, tableTop, colWidths[index], rowHeight).stroke();
      doc.text(header, currentX + cellPadding, tableTop + (rowHeight - 12) / 2, { width: colWidths[index] - 2 * cellPadding });
      currentX += colWidths[index];
    });

    // Draw table rows
    let currentY = tableTop + rowHeight;
    Object.values(groupedByStudent).forEach(student => {
      currentX = startX;

      // Student name
      doc.rect(currentX, currentY, colWidths[0], rowHeight).stroke();
      doc.text(`${student.student.fname} ${student.student.lname}`,
        currentX + cellPadding, currentY + (rowHeight - 12) / 2,
        { width: colWidths[0] - 2 * cellPadding });
      currentX += colWidths[0];

      // Total classes
      doc.rect(currentX, currentY, colWidths[1], rowHeight).stroke();
      doc.text(student.summary.total_classes.toString(),
        currentX + cellPadding, currentY + (rowHeight - 12) / 2,
        { width: colWidths[1] - 2 * cellPadding });
      currentX += colWidths[1];

      // Classes attended
      doc.rect(currentX, currentY, colWidths[2], rowHeight).stroke();
      doc.text(student.summary.attended.toString(),
        currentX + cellPadding, currentY + (rowHeight - 12) / 2,
        { width: colWidths[2] - 2 * cellPadding });
      currentX += colWidths[2];

      // Attendance %
      doc.rect(currentX, currentY, colWidths[3], rowHeight).stroke();
      doc.text(student.summary.attendance_percentage + '%',
        currentX + cellPadding, currentY + (rowHeight - 12) / 2,
        { width: colWidths[3] - 2 * cellPadding });

      currentY += rowHeight;

      // Check if we need a new page
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }
    });

    // Add summary
    const totalStudents = Object.keys(groupedByStudent).length;
    const avgAttendance = totalStudents > 0
      ? Object.values(groupedByStudent).reduce((sum, s) => sum + s.summary.attendance_percentage, 0) / totalStudents
      : 0;

    doc.moveDown(2);
    doc.text(`Summary: Total Students: ${totalStudents}, Average Attendance: ${avgAttendance.toFixed(2)}%`, 50, doc.y);

    // Finalize PDF
    doc.end();

    // Wait for the stream to finish
    writeStream.on('finish', () => {
      // Send the PDF file as response
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      fs.createReadStream(filePath).pipe(res);
    });

  } catch (error) {
    console.error('Error generating monthly attendance PDF:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

export {
  handleStudentJoin,
  handleStudentLeave,
  getDailyAttendance,
  getMonthlyAttendance,
  getAttendanceByCourseAndBatch,
  generateDailyAttendancePDF,
  generateMonthlyAttendancePDF
};