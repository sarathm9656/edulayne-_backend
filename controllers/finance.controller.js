import LiveSession from '../models/Live_Session.model.js';
import InstructorPayment from '../models/instructor_payment.js';
import Batch from '../models/Batch_table.js';
import mongoose from 'mongoose';

/**
 * TENANT: Get overall financial summary for a month
 */
export const getTenantFinancialSummary = async (req, res) => {
    try {
        const { tenantId } = req.params; // Or from req.user
        const { month, year } = req.query;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        // Aggregate All Hours
        const financeStats = await LiveSession.aggregate([
            {
                $match: {
                    tenant_id: new mongoose.Types.ObjectId(tenantId),
                    actual_start_time: { $gte: startDate, $lte: endDate },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    totalSeconds: { $sum: "$duration_seconds" },
                    totalClasses: { $sum: 1 },
                    uniqueInstructors: { $addToSet: "$instructor_id" },
                    uniqueBatches: { $addToSet: "$batch_id" }
                }
            },
            {
                $project: {
                    totalHours: { $round: [{ $divide: ["$totalSeconds", 3600] }, 2] },
                    totalClasses: 1,
                    instructorCount: { $size: "$uniqueInstructors" },
                    batchCount: { $size: "$uniqueBatches" }
                }
            }
        ]);

        // Aggregate Payouts (Paid vs Pending)
        const payoutStats = await InstructorPayment.aggregate([
            {
                $match: {
                    tenant_id: new mongoose.Types.ObjectId(tenantId),
                    month: parseInt(month),
                    year: parseInt(year)
                }
            },
            {
                $group: {
                    _id: "$status",
                    totalAmount: { $sum: "$final_payout" }, // Assuming final_payout field or similar
                    count: { $sum: 1 }
                }
            }
        ]);

        res.json({
            success: true,
            period: { month, year },
            usage: financeStats[0] || { totalHours: 0, totalClasses: 0 },
            financials: payoutStats
        });

    } catch (error) {
        console.error("Finance Summary Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch summary" });
    }
};

/**
 * TENANT: Get Instructor-wise Breakdown
 */
/**
 * TENANT: Get Instructor-wise Breakdown
 */
import Login from '../models/login.model.js';
import Role from '../models/role.model.js';
import axios from 'axios';

const DYTE_API_URL = process.env.DYTE_API_BASE_URL || 'https://api.dyte.io/v2';
const DYTE_ORG_ID = process.env.DYTE_ORG_ID;
const DYTE_API_KEY = process.env.DYTE_API_KEY;

const getAuthHeaders = () => ({
    headers: {
        'Authorization': `Basic ${Buffer.from(`${DYTE_ORG_ID}:${DYTE_API_KEY}`).toString('base64')}`,
        'Content-Type': 'application/json'
    }
});

/**
 * ADMIN: Sync Past Sessions from Dyte
 * Useful if webhooks were missed or for initial setup
 */
export const syncDyteSessions = async (req, res) => {
    try {
        console.log("[Sync] Starting Dyte Session Sync...");

        // 1. Find all Batches that have a Dyte Meeting ID
        const batches = await Batch.find({
            dyte_meeting_id: { $exists: true, $ne: null }
        });

        let totalSynced = 0;

        for (const batch of batches) {
            try {
                // 2. Fetch Sessions for this Meeting ID from Dyte
                // Note: Dyte API might paginate, we fetch first page for now or iterate
                const response = await axios.get(
                    `${DYTE_API_URL}/sessions?meeting_id=${batch.dyte_meeting_id}`,
                    getAuthHeaders()
                );

                const sessions = response.data.data;

                for (const session of sessions) {
                    if (session.status !== 'ENDED') continue;

                    // Check if already logged
                    const exists = await LiveSession.exists({ dyte_meeting_id: session.id });
                    if (exists) continue;

                    // Calculate Duration
                    const startedAt = new Date(session.created_at);
                    const endedAt = new Date(session.updated_at);

                    let durationSeconds = 0;
                    if (session.duration) {
                        durationSeconds = session.duration;
                    } else {
                        durationSeconds = Math.round((endedAt - startedAt) / 1000);
                    }

                    if (durationSeconds < 60) continue; // Skip very short test calls

                    const durationMinutes = parseFloat((durationSeconds / 60).toFixed(2));

                    // 3. Insert into LiveSession
                    // We map using the logic that this session belongs to the batch
                    const newSession = {
                        dyte_meeting_id: session.id, // Unique Session ID from Dyte
                        batch_id: batch._id,
                        tenant_id: batch.tenant_id,
                        instructor_id: batch.instructor_id || (batch.instructor_ids && batch.instructor_ids[0]),
                        actual_start_time: startedAt,
                        actual_end_time: endedAt,
                        duration_seconds: durationSeconds,
                        duration_minutes: durationMinutes,
                        status: 'completed',
                        topic: batch.batch_name + " (Synced)",
                        agenda: "Class Session",
                        scheduled_start_time: session.created_at,
                        scheduled_end_time: session.updated_at,
                        host_url: "https://app.dyte.io",
                        join_url: batch.meeting_link,
                        meeting_duration_completed: durationMinutes + " mins",
                        meeting_participants_count: session.participants_count || 0
                    };

                    await LiveSession.create(newSession);
                    totalSynced++;
                }

            } catch (err) {
                console.error(`[Sync] Failed for batch ${batch.batch_name} (${batch.dyte_meeting_id}):`, err.response?.data || err.message);
                // Continue to next batch
            }
        }

        res.json({ success: true, message: `Synced ${totalSynced} historical sessions successfully.` });

    } catch (error) {
        console.error("Sync Error:", error);
        res.status(500).json({ success: false, message: "Failed to sync sessions" });
    }
};

export const getInstructorAnalytics = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { month, year } = req.query;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        // 1. Get Instructor Role ID
        const instructorRole = await Role.findOne({ name: 'instructor' });
        if (!instructorRole) {
            return res.json({ success: true, instructors: [] }); // No role found
        }

        // 2. Fetch ALL Instructors for this Tenant
        const allInstructors = await Login.find({
            tenant_id: tenantId,
            role_id: instructorRole._id,
            is_active: true
        }).populate('user_id', 'fname lname email');

        // 3. Aggregate Stats for the Period
        const stats = await LiveSession.aggregate([
            {
                $match: {
                    tenant_id: new mongoose.Types.ObjectId(tenantId),
                    actual_start_time: { $gte: startDate, $lte: endDate },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: "$instructor_id",
                    totalSeconds: { $sum: "$duration_seconds" },
                    totalClasses: { $sum: 1 },
                    batchIds: { $addToSet: "$batch_id" }
                }
            }
        ]);

        // 4. Merge Data
        const report = allInstructors.map(inst => {
            const stat = stats.find(s => s._id && s._id.toString() === inst._id.toString());

            return {
                _id: inst._id,
                instructorName: inst.user_id ? `${inst.user_id.fname} ${inst.user_id.lname}` : 'Unknown',
                instructorEmail: inst.email,
                totalHours: stat ? parseFloat((stat.totalSeconds / 3600).toFixed(2)) : 0,
                totalClasses: stat ? stat.totalClasses : 0,
                activeBatches: stat ? stat.batchIds.length : 0
            };
        });

        res.json({ success: true, instructors: report });

    } catch (error) {
        console.error("Instructor Analytics Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch instructor analytics" });
    }
};

/**
 * TENANT: Get Detailed Logs (Daily View)
 */
export const getTenantLogs = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { month, year, instructorId, page = 1, limit = 20 } = req.query;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const filter = {
            tenant_id: new mongoose.Types.ObjectId(tenantId),
            actual_start_time: { $gte: startDate, $lte: endDate },
            status: 'completed'
        };

        if (instructorId) {
            filter.instructor_id = new mongoose.Types.ObjectId(instructorId);
        }

        const logs = await LiveSession.find(filter)
            .sort({ actual_start_time: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate({
                path: 'instructor_id',
                select: 'user_id',
                populate: { path: 'user_id', select: 'fname lname email' }
            })
            .populate('batch_id', 'batch_name');

        const total = await LiveSession.countDocuments(filter);

        res.json({
            success: true,
            logs,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("Tenant Logs Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch logs" });
    }
};

/**
 * INSTRUCTOR: Get My Earnings/Stats
 */
export const getMyEarnings = async (req, res) => {
    try {
        const instructorId = req.user.id || req.user.user_id;
        const { month, year } = req.query;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        // 1. Calculate Work Done (Source of Truth)
        const workStats = await LiveSession.aggregate([
            {
                $match: {
                    instructor_id: new mongoose.Types.ObjectId(instructorId),
                    actual_start_time: { $gte: startDate, $lte: endDate },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    totalSeconds: { $sum: "$duration_seconds" },
                    totalClasses: { $sum: 1 }
                }
            }
        ]);

        const totalHours = workStats.length > 0 ? (workStats[0].totalSeconds / 3600).toFixed(2) : 0;
        const totalClasses = workStats.length > 0 ? workStats[0].totalClasses : 0;

        // 2. Fetch Payment Record (Settlement)
        const paymentRecord = await InstructorPayment.findOne({
            instructor_id: instructorId,
            month: parseInt(month),
            year: parseInt(year)
        });

        res.json({
            success: true,
            summary: {
                totalHours: parseFloat(totalHours),
                totalClasses,
                month,
                year
            },
            paymentStatus: paymentRecord ? paymentRecord.status : 'pending_calculation',
            paymentDetails: paymentRecord || null
        });

    } catch (error) {
        console.error("My Earnings Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch earnings" });
    }
};

/**
 * INSTRUCTOR: Get My Detailed Logs
 */
export const getInstructorLogs = async (req, res) => {
    try {
        const instructorId = req.user.id || req.user.user_id;
        const { month, year, page = 1, limit = 20 } = req.query;

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        const filter = {
            instructor_id: new mongoose.Types.ObjectId(instructorId),
            actual_start_time: { $gte: startDate, $lte: endDate },
            status: 'completed'
        };

        const logs = await LiveSession.find(filter)
            .sort({ actual_start_time: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('batch_id', 'batch_name');

        const total = await LiveSession.countDocuments(filter);

        res.json({
            success: true,
            logs,
            pagination: {
                total,
                page: parseInt(page),
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error("Instructor Logs Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch logs" });
    }
};
