import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  join_time: {
    type: Date,
    required: true
  },
  leave_time: {
    type: Date
  },
  duration_seconds: {
    type: Number,
    default: 0
  }
});

const attendanceSchema = new mongoose.Schema({
  student_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  course_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  batch_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch',
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'late'],
    default: 'absent' // Initially absent until sessions are recorded
  },
  marked_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Instructor or admin who marked attendance
    required: true
  },
  total_duration_seconds: {
    type: Number,
    default: 0
  },
  sessions: [sessionSchema], // Array to store multiple join/leave sessions
  remarks: {
    type: String,
    default: ''
  },
  class_start_time: {
    type: Date,
    required: true
  },
  class_end_time: {
    type: Date
  },
  is_manual_override: {
    type: Boolean,
    default: false // True if admin manually changed status
  }
}, {
  timestamps: true
});

// Index for efficient queries
attendanceSchema.index({ student_id: 1, course_id: 1, date: 1 }, { unique: true });
attendanceSchema.index({ batch_id: 1, date: 1 });

export default mongoose.model('Attendance', attendanceSchema);