import axios from 'axios';
import moment from 'moment';
import Batch from '../../models/Batch_table.js';
import Login from '../../models/login.model.js';
import Attendance from '../../models/Attendance.js';
import { uploadToYouTube } from '../../services/youtube.service.js';
import path from 'path';
import fs from 'fs';
import https from 'https';

const DYTE_API_URL = process.env.DYTE_API_BASE_URL || 'https://api.dyte.io/v2';
const DYTE_ORG_ID = process.env.DYTE_ORG_ID;
const DYTE_API_KEY = process.env.DYTE_API_KEY;

/* -------------------- HELPERS -------------------- */

const getAuthHeaders = () => ({
  headers: {
    Authorization: `Basic ${Buffer.from(`${DYTE_ORG_ID}:${DYTE_API_KEY}`).toString('base64')}`,
    'Content-Type': 'application/json'
  }
});

/**
 * 🔑 STRICT-MODE AWARE VALIDATION
 */
const validateClassTime = (batch) => {

  // 🔥 MASTER SWITCH
  if (batch.is_strict_schedule === false) {
    return { valid: true };
  }

  const today = moment();

  if (batch.status === 'completed')
    return { valid: false, message: "Batch is already completed" };

  if (batch.status === 'inactive')
    return { valid: false, message: "Batch is currently inactive" };

  if (batch.start_date && today.isBefore(moment(batch.start_date).startOf('day')))
    return { valid: false, message: "Batch has not started yet" };

  if (batch.end_date && today.isAfter(moment(batch.end_date).endOf('day')))
    return { valid: false, message: "Batch has ended" };

  if (!batch.recurring_days?.includes(today.format('dddd')))
    return { valid: false, message: "Today is not a scheduled class day" };

  if (batch.batch_time) {
    const [start, end] = batch.batch_time.split("-").map(s => s.trim());
    const startTime = moment(start, ['h:mm A', 'H:mm']);
    startTime.set({ year: today.year(), month: today.month(), date: today.date() });

    if (today.isBefore(moment(startTime).subtract(15, 'minutes')))
      return { valid: false, message: "Class has not started yet" };

    if (end) {
      const endTime = moment(end, ['h:mm A', 'H:mm']);
      endTime.set({ year: today.year(), month: today.month(), date: today.date() });
      if (today.isAfter(endTime))
        return { valid: false, message: "Class is over for today" };
    }
  }

  return { valid: true };
};

const createDyteMeeting = async (title) => {
  const res = await axios.post(
    `${DYTE_API_URL}/meetings`,
    { title, record_on_start: true },
    getAuthHeaders()
  );
  return res.data.data;
};

const addParticipant = async (meetingId, name, preset, userId) => {
  const res = await axios.post(
    `${DYTE_API_URL}/meetings/${meetingId}/participants`,
    {
      name,
      preset_name: preset,
      client_specific_id: userId
    },
    getAuthHeaders()
  );
  return res.data.data;
};

const getUserName = async (userId) => {
  try {
    const user = await Login.findById(userId).populate('user_id');
    if (user?.user_id) {
      return `${user.user_id.fname} ${user.user_id.lname}`;
    }
    return user?.email || "User";
  } catch {
    return "User";
  }
};

/* -------------------- CONTROLLERS -------------------- */

export const startBatchClass = async (req, res) => {
  try {
    const { batchId } = req.body;
    const userId = req.user.id || req.user.user_id;
    const role = req.user.role;

    if (!batchId)
      return res.status(400).json({ success: false, message: "Batch ID required" });

    if (!['tenant', 'instructor', 'admin', 'superadmin'].includes(role))
      return res.status(403).json({ success: false, message: "Not allowed" });

    const batch = await Batch.findById(batchId);
    if (!batch)
      return res.status(404).json({ success: false, message: "Batch not found" });

    const validation = validateClassTime(batch);
    if (!validation.valid)
      return res.status(400).json({ success: false, message: validation.message });

    // Ensure meeting
    if (!batch.dyte_meeting_id || batch.meeting_platform !== 'Dyte') {
      const meeting = await createDyteMeeting(batch.batch_name);
      batch.dyte_meeting_id = meeting.id;
      batch.meeting_platform = 'Dyte';
    }

    // 🔓 Session unlock
    batch.last_class_start_time = new Date();
    await batch.save();

    const name = await getUserName(userId);
    const participant = await addParticipant(
      batch.dyte_meeting_id,
      name,
      'group_call_host',
      userId
    );

    res.json({
      success: true,
      meeting_id: batch.dyte_meeting_id,
      authToken: participant.token,
      role: 'instructor'
    });

  } catch (err) {
    console.error("Start Class Error:", err);
    res.status(500).json({ success: false, message: "Failed to start class" });
  }
};

export const joinBatchClass = async (req, res) => {
  try {
    const { batchId } = req.body;
    const userId = req.user.id || req.user.user_id;
    const role = req.user.role;

    if (!batchId)
      return res.status(400).json({ success: false, message: "Batch ID required" });

    const batch = await Batch.findById(batchId);
    if (!batch)
      return res.status(404).json({ success: false, message: "Batch not found" });

    const validation = validateClassTime(batch);
    if (!validation.valid)
      return res.status(400).json({ success: false, message: validation.message });

    // 🔥 STRICT OFF → auto meeting create
    if (!batch.dyte_meeting_id || batch.meeting_platform !== 'Dyte') {
      if (batch.is_strict_schedule === false) {
        const meeting = await createDyteMeeting(batch.batch_name);
        batch.dyte_meeting_id = meeting.id;
        batch.meeting_platform = 'Dyte';
        await batch.save();
      } else {
        return res.status(400).json({
          success: false,
          message: "Instructor has not started the class yet"
        });
      }
    }

    const name = await getUserName(userId);
    const preset = (role === 'tenant' || role === 'instructor')
      ? 'group_call_host'
      : 'group_call_participant';

    const participant = await addParticipant(
      batch.dyte_meeting_id,
      name,
      preset,
      userId
    );

    // Attendance (student only)
    if (role === 'student') {
      await Attendance.create({
        student_id: userId,
        batch_id: batch._id,
        date: new Date(),
        status: 'present'
      });
    }

    res.json({
      success: true,
      meeting_id: batch.dyte_meeting_id,
      authToken: participant.token,
      role
    });

  } catch (err) {
    console.error("Join Class Error:", err);
    res.status(500).json({ success: false, message: "Failed to join class" });
  }
};
