import axios from 'axios';
import moment from 'moment';
import Batch from '../../models/Batch_table.js';
import Login from '../../models/login.model.js';
import Attendance from '../../models/Attendance.js';

const DYTE_API_URL = process.env.DYTE_API_BASE_URL || 'https://api.dyte.io/v2';
const DYTE_ORG_ID = process.env.DYTE_ORG_ID;
const DYTE_API_KEY = process.env.DYTE_API_KEY;

/* -------------------- HELPERS -------------------- */

const dyteHeaders = () => ({
  headers: {
    Authorization: `Basic ${Buffer.from(`${DYTE_ORG_ID}:${DYTE_API_KEY}`).toString('base64')}`,
    'Content-Type': 'application/json'
  }
});

const sendError = (res, code, message, status = 400) =>
  res.status(status).json({ success: false, code, message });

/**
 * STRICT MODE AWARE VALIDATION
 */
const validateClassTime = (batch) => {
  if (batch.is_strict_schedule === false) {
    return { valid: true }; // 🔑 MASTER BYPASS
  }

  const today = moment();

  if (batch.status === 'completed')
    return { valid: false, code: 'BATCH_COMPLETED', message: 'Batch completed' };

  if (batch.status === 'inactive')
    return { valid: false, code: 'BATCH_INACTIVE', message: 'Batch inactive' };

  if (!batch.recurring_days?.includes(today.format('dddd')))
    return { valid: false, code: 'WRONG_DAY', message: 'Not a class day' };

  if (batch.batch_time) {
    const [start, end] = batch.batch_time.split('-').map(s => s.trim());
    const startTime = moment(start, ['h:mm A', 'H:mm']);
    startTime.set({ year: today.year(), month: today.month(), date: today.date() });

    if (today.isBefore(moment(startTime).subtract(15, 'minutes')))
      return { valid: false, code: 'TOO_EARLY', message: 'Class not started yet' };

    if (end) {
      const endTime = moment(end, ['h:mm A', 'H:mm']);
      endTime.set({ year: today.year(), month: today.month(), date: today.date() });
      if (today.isAfter(endTime))
        return { valid: false, code: 'CLASS_OVER', message: 'Class ended' };
    }
  }

  return { valid: true };
};

const createMeeting = async (title) => {
  const res = await axios.post(
    `${DYTE_API_URL}/meetings`,
    { title, record_on_start: true },
    dyteHeaders()
  );
  return res.data.data.id;
};

const addParticipant = async (meetingId, name, preset, userId) => {
  const res = await axios.post(
    `${DYTE_API_URL}/meetings/${meetingId}/participants`,
    { name, preset_name: preset, client_specific_id: userId },
    dyteHeaders()
  );
  return res.data.data.token;
};

/* -------------------- CONTROLLERS -------------------- */

export const startBatchClass = async (req, res) => {
  try {
    const { batchId } = req.body;
    const userId = req.user.id;
    const role = req.user.role;

    if (!['tenant', 'instructor', 'admin'].includes(role))
      return sendError(res, 'FORBIDDEN', 'Not allowed', 403);

    const batch = await Batch.findById(batchId);
    if (!batch) return sendError(res, 'BATCH_NOT_FOUND', 'Batch not found');

    const validation = validateClassTime(batch);
    if (!validation.valid)
      return sendError(res, validation.code, validation.message);

    if (!batch.dyte_meeting_id) {
      batch.dyte_meeting_id = await createMeeting(batch.batch_name);
      batch.meeting_platform = 'Dyte';
    }

    batch.last_class_start_time = new Date();
    await batch.save();

    const name = await Login.findById(userId).then(u => u.email);
    const token = await addParticipant(batch.dyte_meeting_id, name, 'group_call_host', userId);

    res.json({
      success: true,
      meeting_id: batch.dyte_meeting_id,
      authToken: token,
      role: 'instructor'
    });

  } catch (e) {
    console.error(e);
    sendError(res, 'START_FAILED', 'Unable to start class', 500);
  }
};

export const joinBatchClass = async (req, res) => {
  try {
    const batchId = req.body.batchId;
    const userId = req.user.id;
    const role = req.user.role;

    const batch = await Batch.findById(batchId);
    if (!batch) return sendError(res, 'BATCH_NOT_FOUND', 'Batch not found');

    const validation = validateClassTime(batch);
    if (!validation.valid)
      return sendError(res, validation.code, validation.message);

    // 🔥 STRICT OFF → auto create meeting
    if (!batch.dyte_meeting_id && batch.is_strict_schedule === false) {
      batch.dyte_meeting_id = await createMeeting(batch.batch_name);
      batch.meeting_platform = 'Dyte';
      await batch.save();
    }

    if (!batch.dyte_meeting_id)
      return sendError(res, 'CLASS_NOT_STARTED', 'Instructor not started');

    const name = await Login.findById(userId).then(u => u.email);
    const preset = role === 'student' ? 'group_call_participant' : 'group_call_host';

    const token = await addParticipant(batch.dyte_meeting_id, name, preset, userId);

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
      authToken: token,
      role
    });

  } catch (e) {
    console.error(e);
    sendError(res, 'JOIN_FAILED', 'Unable to join class', 500);
  }
};
