import mongoose from 'mongoose';

const liveSessionSchema = new mongoose.Schema({
    live_session_Id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        default: function () {
            return this._id;
        }
    },
    dyte_meeting_id: {
        type: String,
        required: true
    },
    topic: {
        type: String,
        required: true
    },
    agenda: {
        type: String,
        required: true
    },
    scheduled_start_time: {
        type: String,
        required: true
    },
    scheduled_end_time: {
        type: String,
        required: true
    },
    host_url: {
        type: String,
        required: true
    },
    join_url: {
        type: String,
        required: true
    },
    // We can remove passcode as Dyte rooms are token-gated
    passcode: {
        type: String,
        required: false
    },
    status: {
        type: String,
        enum: ['ongoing', 'completed', 'scheduled', 'cancelled'],
        default: 'scheduled',
        required: true
    },
    meeting_duration_completed: {
        type: String
    },
    meeting_participants_count: {
        type: Number
    },
    // Add batch reference
    batch_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Batch',
        required: false // Optional - can be assigned later
    },
    // Add tenant and instructor references for better tracking
    tenant_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tenant',
        required: false
    },
    instructor_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Login',
        required: false
    },

    // Finance / Analytics Fields (Populated by Webhook)
    actual_start_time: {
        type: Date
    },
    actual_end_time: {
        type: Date
    },
    duration_seconds: {
        type: Number,
        default: 0
    },
    duration_minutes: {
        type: Number,
        default: 0
    },

}, {
    timestamps: {
        createdAt: 'created_at',
        updatedAt: 'updated_at'
    }
});

// Create indexes for better query performance
liveSessionSchema.index({ live_session_Id: 1 }, { unique: true });
liveSessionSchema.index({ dyte_meeting_id: 1 }, { unique: true });
liveSessionSchema.index({ status: 1 });
liveSessionSchema.index({ batch_id: 1 });
liveSessionSchema.index({ tenant_id: 1 });

const LiveSession = mongoose.model('LiveSession', liveSessionSchema);

export default LiveSession;
