import axios from 'axios';
import moment from 'moment';
import Batch from '../../models/Batch_table.js';
import Login from '../../models/login.model.js';
import { uploadToYouTube } from '../../services/youtube.service.js';
import path from 'path';
import fs from 'fs';
import https from 'https';

const DYTE_API_URL = process.env.DYTE_API_BASE_URL || 'https://api.dyte.io/v2';
const DYTE_ORG_ID = process.env.DYTE_ORG_ID;
const DYTE_API_KEY = process.env.DYTE_API_KEY;

const getAuthHeaders = () => ({
    headers: {
        'Authorization': `Basic ${Buffer.from(`${DYTE_ORG_ID}:${DYTE_API_KEY}`).toString('base64')}`,
        'Content-Type': 'application/json'
    }
});

const validateClassTime = (batch) => {
    const today = moment();

    // 1. Check Status
    if (batch.status === 'completed') {
        return { valid: false, message: "Batch is already completed" };
    }
    if (batch.status === 'inactive') {
        return { valid: false, message: "Batch is currently inactive" };
    }

    // 2. Check Date Range
    if (batch.start_date && today.isBefore(moment(batch.start_date).startOf('day'))) {
        return { valid: false, message: "Batch has not started yet" };
    }
    if (batch.end_date && today.isAfter(moment(batch.end_date).endOf('day'))) {
        return { valid: false, message: "Batch is already completed" };
    }

    // 3. Check Recurring Days
    if (!batch.recurring_days || batch.recurring_days.length === 0) {
        return { valid: false, message: "No class days defined for this batch." };
    }
    const todayDay = today.format('dddd');
    if (!batch.recurring_days.includes(todayDay)) {
        return { valid: false, message: "Today is not a scheduled class day" };
    }

    // 4. Check Time
    if (batch.batch_time) {
        let startStr = batch.batch_time;
        let endStr = null;

        // Try to split logic "10:00 AM - 11:00 AM"
        if (batch.batch_time.includes("-")) {
            const parts = batch.batch_time.split("-");
            startStr = parts[0].trim();
            if (parts.length > 1) endStr = parts[1].trim();
        }

        // Start Time Check
        const formatStart = startStr.toUpperCase().includes('M') ? 'h:mm A' : 'H:mm';
        const startTime = moment(startStr, formatStart);
        startTime.set({ year: today.year(), month: today.month(), date: today.date() });

        // Buffer: Allow joining 15 mins before
        const allowedStart = moment(startTime).subtract(15, 'minutes');

        if (today.isBefore(allowedStart)) {
            return { valid: false, message: "Class time is not valid now" };
        }

        // End Time Check
        if (endStr) {
            const formatEnd = endStr.toUpperCase().includes('M') ? 'h:mm A' : 'H:mm';
            const endTime = moment(endStr, formatEnd);
            endTime.set({ year: today.year(), month: today.month(), date: today.date() });

            if (today.isAfter(endTime)) {
                return { valid: false, message: "Batch class time is over for today" };
            }
        }
    }

    return { valid: true };
};

// ... (helper functions addParticipant, etc. remain same) ...

// Helper to add participant (keep this mostly same, just ensure it's here if I'm replacing lines around it)
// But I am replacing lines 21 to 200, so I need to include addParticipant, getUserName, createDyteMeeting and startBatchClass/joinBatchClass starts.

// Helper to add participant
const addParticipant = async (meetingId, name, presetName, clientSpecificId) => {
    try {
        const payload = {
            name,
            preset_name: presetName,
            client_specific_id: clientSpecificId,
        };
        const response = await axios.post(
            `${DYTE_API_URL}/meetings/${meetingId}/participants`,
            payload,
            getAuthHeaders()
        );
        return response.data.data; // contains token
    } catch (err) {
        const status = err.response?.status;
        const msg = err.response?.data?.message || err.message;
        const error = new Error(msg);
        error.status = status;
        throw error;
    }
};

const getUserName = async (userId) => {
    try {
        const user = await Login.findById(userId).populate('user_id');
        if (user && user.user_id) {
            return `${user.user_id.fname} ${user.user_id.lname}`;
        }
        return user?.email || "User";
    } catch (e) {
        return "User";
    }
}

const createDyteMeeting = async (title) => {
    try {
        const response = await axios.post(`${DYTE_API_URL}/meetings`, {
            title: title || "New Meeting",
            preferred_region: 'ap-south-1',
            record_on_start: true
        }, getAuthHeaders());
        return response.data.data;
    } catch (error) {
        console.error("Create Meeting Error:", error.response?.data || error.message);
        throw error;
    }
};

export const startBatchClass = async (req, res) => {
    try {
        const { batchId } = req.body;
        const userId = req.user.id || req.user.user_id;
        const userRole = req.user.role;

        // Role Check: Only Admin/Instructor/Tenant can START checks
        if (!['admin', 'instructor', 'tenant', 'superadmin'].includes(userRole)) {
            return res.status(403).json({ success: false, message: "Only instructors can start the class." });
        }

        const batch = await Batch.findById(batchId);
        if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

        const validation = validateClassTime(batch);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.message });
        }

        let meetingId = batch.dyte_meeting_id;
        let participant = null;

        // Helper to update batch
        const createNewMeetingForBatch = async () => {
            const newMeeting = await createDyteMeeting(batch.batch_name);
            batch.dyte_meeting_id = newMeeting.id;
            batch.meeting_platform = 'Dyte';
            batch.meeting_link = `https://app.dyte.io/v2/meeting?id=${newMeeting.id}`;
            await batch.save();
            return newMeeting.id;
        };

        if (!meetingId || batch.meeting_platform !== 'Dyte') {
            meetingId = await createNewMeetingForBatch();
        }

        const name = await getUserName(userId);
        try {
            participant = await addParticipant(meetingId, name, 'group_call_host', userId);
        } catch (error) {
            if (error.status === 404 || error.status === 400 || error.status === 401) {
                console.log("Meeting ID invalid or not found. Creating new meeting...", error.message);
                meetingId = await createNewMeetingForBatch();
                participant = await addParticipant(meetingId, name, 'group_call_host', userId);
            } else {
                throw error;
            }
        }

        res.json({
            success: true,
            meeting_id: meetingId,
            authToken: participant.token,
            role: 'instructor'
        });

    } catch (error) {
        console.error("Dyte Start Class Error:", error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.message || 'Failed to start class.' });
    }
};

import Attendance from '../../models/Attendance.js';

export const joinBatchClass = async (req, res) => {
    try {
        const { batchId } = req.body;
        const userId = req.user.id || req.user.user_id;

        const batch = await Batch.findById(batchId);
        if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

        const validation = validateClassTime(batch);
        if (!validation.valid) {
            return res.status(400).json({ success: false, message: validation.message });
        }

        if (!batch.dyte_meeting_id || batch.meeting_platform !== 'Dyte') {
            return res.status(400).json({ success: false, message: "Class has not been started yet." });
        }

        // Add User as Participant
        const name = await getUserName(userId);
        const userRole = req.user.role; // Assuming role is available in req.user from authMiddleware

        // Determine role/preset. 
        // Admin (tenant) and Instructor should have host options.
        let preset = 'group_call_participant';
        if (userRole === 'tenant' || userRole === 'instructor') {
            preset = 'group_call_host';
        }

        const participant = await addParticipant(batch.dyte_meeting_id, name, preset, userId);

        // --- ATTENDANCE MARKING ---
        if (userRole === 'student') {
            try {
                const loginUser = await Login.findById(userId);
                if (loginUser && loginUser.user_id) {
                    const studentProfileId = loginUser.user_id;

                    const today = moment();

                    // Parse Class Start Time
                    let startTimeStr = batch.batch_time;
                    if (startTimeStr && startTimeStr.includes("-")) {
                        startTimeStr = startTimeStr.split("-")[0].trim();
                    }

                    const format = startTimeStr && startTimeStr.includes('M') ? 'h:mm A' : 'H:mm';
                    const classStartTime = startTimeStr ? moment(startTimeStr, format) : moment();
                    classStartTime.set({
                        year: today.year(),
                        month: today.month(),
                        date: today.date()
                    });

                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);

                    const query = {
                        student_id: studentProfileId,
                        course_id: batch.course_id,
                        batch_id: batch._id,
                        date: {
                            $gte: todayStart,
                            $lt: new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
                        }
                    };

                    let attendance = await Attendance.findOne(query);

                    if (!attendance) {
                        attendance = new Attendance({
                            student_id: studentProfileId,
                            course_id: batch.course_id,
                            batch_id: batch._id,
                            date: new Date(),
                            marked_by: studentProfileId, // Self-marked
                            class_start_time: classStartTime.toDate(),
                            status: 'present',
                            sessions: []
                        });
                    }

                    // Add new session
                    attendance.sessions.push({
                        join_time: new Date(),
                        leave_time: null,
                        duration_seconds: 0
                    });

                    await attendance.save();
                    console.log(`[Attendance] Marked for student ${studentProfileId} in batch ${batch._id}`);
                }
            } catch (err) {
                console.error("[Attendance] Failed to mark attendance in Dyte controller:", err);
                // Do not block the join process
            }
        }
        // -------------------------

        res.json({
            success: true,
            meeting_id: batch.dyte_meeting_id,
            authToken: participant.token,
            role: userRole || 'student'
        });

    } catch (error) {
        console.error("Dyte Join Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to join class." });
    }
};

export const getBatchRecordings = async (req, res) => {
    try {
        const { batchId } = req.params;
        const batch = await Batch.findById(batchId);

        if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

        // Fetch Dyte recordings if meeting exists
        let dyteRecordings = [];
        if (batch.dyte_meeting_id) {
            try {
                const response = await axios.get(
                    `${DYTE_API_URL}/recordings?meeting_id=${batch.dyte_meeting_id}`,
                    getAuthHeaders()
                );
                dyteRecordings = response.data.data.map(rec => ({
                    ...rec,
                    type: 'dyte',
                    id: rec.id,
                    title: `Recording - ${moment(rec.created_at).format('MMM Do, YYYY')}`,
                    url: rec.url || rec.download_url,
                    created_at: rec.created_at,
                    duration: rec.duration,
                    status: rec.status
                }));
            } catch (error) {
                console.error("Dyte API Error:", error.message);
            }
        }

        // Fetch manual recordings
        const manualRecordings = (batch.manual_recordings || []).map(rec => ({
            ...rec.toObject(),
            type: 'manual',
            id: rec._id,
            title: rec.title,
            // Use YouTube URL if available, otherwise use local path
            url: rec.youtube_url || `/api/${rec.file_path.replace(/\\/g, '/')}`,
            created_at: rec.uploaded_at,
            status: 'AVAILABLE'
        }));

        // Combine and sort by date
        const allRecordings = [...dyteRecordings, ...manualRecordings].sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );

        res.json({ success: true, recordings: allRecordings });

    } catch (error) {
        console.error("Get Recordings Error:", error);
        res.json({ success: false, message: "Failed to fetch recordings", recordings: [] });
    }
};

export const uploadManualRecording = async (req, res) => {
    try {
        const { batchId } = req.params;
        const { title } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ success: false, message: "No file uploaded" });

        const batch = await Batch.findById(batchId);
        if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

        let youtubeUrl = null;
        if (req.body.upload_to_youtube === 'true') {
            try {
                const absolutePath = path.resolve(file.path);
                const ytResult = await uploadToYouTube(absolutePath, {
                    title: title || `GoChess Class - ${batch.batch_name} - ${moment().format('MMM Do, YYYY')}`,
                    description: `Class recording for batch ${batch.batch_name} on ${moment().format('LL')}.`,
                    privacyStatus: 'unlisted'
                });
                if (ytResult.success) {
                    youtubeUrl = ytResult.url;
                }
            } catch (ytError) {
                console.error("YouTube Upload error (non-fatal):", ytError);
                // We still saved it locally, so we continue
            }
        }

        batch.manual_recordings.push({
            title: title || `Manual Recording - ${moment().format('MMM Do, YYYY')}`,
            file_path: file.path,
            youtube_url: youtubeUrl,
            uploaded_at: new Date()
        });

        await batch.save();

        res.json({
            success: true,
            message: youtubeUrl ? "Recording uploaded to system and YouTube" : "Recording uploaded to system",
            recording: batch.manual_recordings[batch.manual_recordings.length - 1],
            youtube_url: youtubeUrl
        });

    } catch (error) {
        console.error("Upload Recording Error:", error);
        res.status(500).json({ success: false, message: "Failed to upload recording" });
    }
};

export const handleDyteWebhook = async (req, res) => {
    try {
        // req.body is a buffer because of express.raw in routes
        const payload = JSON.parse(req.body.toString());
        const { event, data } = payload;

        console.log(`Received Dyte Webhook: ${event}`);

        if (event === 'recording.status.update' && data.status === 'COMPLETED') {
            const { meeting_id, download_url, id: recording_id } = data;

            const batch = await Batch.findOne({ dyte_meeting_id: meeting_id });
            if (batch) {
                const fileName = `recording_${meeting_id}_${recording_id}.mp4`;
                const relativePath = path.join('uploads', 'recordings', fileName);
                const fullPath = path.resolve(relativePath);

                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                const file = fs.createWriteStream(fullPath);
                https.get(download_url, (response) => {
                    response.pipe(file);
                    file.on('finish', async () => {
                        file.close();
                        batch.manual_recordings.push({
                            title: `Auto Recording - ${moment().format('MMM Do, YYYY')}`,
                            file_path: relativePath,
                            uploaded_at: new Date()
                        });
                        await batch.save();
                        console.log(`Recording saved locally: ${relativePath}`);
                    });
                });
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error("Webhook Error:", error);
        res.status(500).send('Internal Server Error');
    }
};
