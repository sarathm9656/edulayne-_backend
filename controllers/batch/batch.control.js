import Batch from "../../models/Batch_table.js";
import BatchStudent from "../../models/Batch_Students.js";
import mongoose from "mongoose";

export const createBatch = async (req, res) => {
  try {
    const {
      course_id,
      batch_name,
      instructor_id,
      instructor_ids,
      start_date,
      end_date,
      status,
      subscription_price,
      subscription_enabled,
      max_students,
      batch_time,
      recurring_days,
      meeting_link,
      meeting_platform,
      is_strict_schedule,
    } = req.body;
    const tenant_id = req.user.tenant_id;

    // Validate required fields
    if (
      !course_id ||
      !batch_name ||
      !start_date ||
      !end_date
    ) {
      return res.status(400).json({
        success: false,
        message:
          "All fields are required: course_id, batch_name, start_date, end_date",
      });
    }

    // Validate that at least one instructor is provided
    // if (!instructor_id && (!instructor_ids || instructor_ids.length === 0)) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "At least one instructor is required",
    //   });
    // }

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    // Validate date format and logic
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format for start_date or end_date",
      });
    }

    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        message: "End date must be after start date",
      });
    }

    // Check if batch name already exists for the same course and tenant
    const existingBatch = await Batch.findOne({
      tenant_id,
      course_id,
      batch_name: { $regex: new RegExp(`^${batch_name}$`, "i") }, // Case-insensitive match
    });

    if (existingBatch) {
      return res.status(409).json({
        success: false,
        message: "Batch name already exists for this course in this tenant",
      });
    }

    // Prepare instructor data
    let finalInstructorIds = [];
    if (instructor_ids && instructor_ids.length > 0) {
      finalInstructorIds = instructor_ids;
    } else if (instructor_id) {
      finalInstructorIds = [instructor_id];
    }

    // Create new batch
    const newBatch = new Batch({
      tenant_id,
      course_id,
      batch_name,
      instructor_id: finalInstructorIds[0], // Keep primary instructor for backward compatibility
      instructor_ids: finalInstructorIds,
      start_date: startDate,
      end_date: endDate,
      status: status || "active",
      subscription_price: subscription_price || 1000,
      subscription_enabled: subscription_enabled !== undefined ? subscription_enabled : true,
      max_students: max_students || 0,
      batch_time,
      recurring_days: recurring_days || [],
      meeting_link,
      meeting_platform,
      is_strict_schedule: is_strict_schedule !== undefined ? is_strict_schedule : true,
    });

    const savedBatch = await newBatch.save();

    // Populate references for better response
    await savedBatch.populate([
      { path: "tenant_id", select: "name" },
      { path: "course_id", select: "course_title" },
      {
        path: "instructor_id",
        select: "email",
        populate: {
          path: "user_id",
          select: "fname lname",
        },
      },
      {
        path: "instructor_ids",
        select: "email",
        populate: {
          path: "user_id",
          select: "fname lname",
        },
      },
    ]);

    return res.status(201).json({
      success: true,
      message: "Batch created successfully",
      data: savedBatch,
    });
  } catch (error) {
    console.error("Error creating batch:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get all batches
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getAllBatches = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const batches = await Batch.find({ tenant_id })
      .populate("tenant_id", "name")
      .populate("course_id", "course_title")
      .populate({
        path: "instructor_id",
        select: "email",
        populate: {
          path: "user_id",
          select: "fname lname",
        },
      })
      .populate({
        path: "instructor_ids",
        select: "email",
        populate: {
          path: "user_id",
          select: "fname lname",
        },
      })
      .sort({ created_at: -1 });

    // Get enrollment counts for each batch
    const batchesWithEnrollment = await Promise.all(
      batches.map(async (batch) => {
        const enrollmentCount = await BatchStudent.countDocuments({
          batch_id: batch._id,
        });

        return {
          ...batch.toObject(),
          enrollment_count: enrollmentCount,
        };
      })
    );

    return res.status(200).json({
      success: true,
      message: "Batches retrieved successfully",
      data: batchesWithEnrollment,
    });
  } catch (error) {
    console.error("Error fetching batches:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get batch by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getBatchById = async (req, res) => {
  try {
    const { batch_id } = req.params;
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const batch = await Batch.findOne({ _id: batch_id, tenant_id })
      .populate("tenant_id", "name")
      .populate("course_id", "course_title")
      .populate({
        path: "instructor_id",
        select: "email",
        populate: {
          path: "user_id",
          select: "fname lname",
        },
      });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Batch retrieved successfully",
      data: batch,
    });
  } catch (error) {
    console.error("Error fetching batch:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Update batch
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateBatch = async (req, res) => {
  try {
    const { batch_id } = req.params;
    const updateData = req.body;
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    // Remove batch_id from update data if present
    delete updateData.batch_id;

    // Sanitize ObjectId fields to prevent CastError
    if (updateData.instructor_id === "") delete updateData.instructor_id;
    if (updateData.course_id === "") delete updateData.course_id;

    // 1. Fetch existing batch to allow robust partial validation
    const existingBatch = await Batch.findOne({ _id: batch_id, tenant_id });
    if (!existingBatch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    // 2. Validate dates (merge with existing if partial update)
    const startDateVal = updateData.start_date ? new Date(updateData.start_date) : existingBatch.start_date;
    const endDateVal = updateData.end_date ? new Date(updateData.end_date) : existingBatch.end_date;

    if (isNaN(startDateVal.getTime()) || isNaN(endDateVal.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    if (startDateVal >= endDateVal) {
      return res.status(400).json({
        success: false,
        message: "End date must be after start date",
      });
    }

    // 3. Duplicate Name Check (only if name changed)
    if (updateData.batch_name && updateData.batch_name.trim().toLowerCase() !== existingBatch.batch_name.toLowerCase()) {
      const courseId = updateData.course_id || existingBatch.course_id;

      const duplicate = await Batch.findOne({
        tenant_id,
        course_id: courseId,
        batch_name: { $regex: new RegExp(`^${updateData.batch_name}$`, "i") },
        _id: { $ne: batch_id }, // Exclude current batch
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Batch name already exists for this course in this tenant",
        });
      }
    }

    // 4. Update
    const updatedBatch = await Batch.findOneAndUpdate(
      { _id: batch_id, tenant_id },
      { ...updateData, tenant_id },
      { new: true, runValidators: true }
    ).populate([
      { path: "tenant_id", select: "name" },
      { path: "course_id", select: "course_title" },
      {
        path: "instructor_id",
        select: "email",
        populate: {
          path: "user_id",
          select: "fname lname",
        },
      },
      {
        path: "instructor_ids",
        select: "email",
        populate: {
          path: "user_id",
          select: "fname lname",
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "Batch updated successfully",
      data: updatedBatch,
    });
  } catch (error) {
    console.error("Error updating batch:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Delete batch
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteBatch = async (req, res) => {
  try {
    const { batch_id } = req.params;
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const deletedBatch = await Batch.findOneAndDelete({ _id: batch_id, tenant_id });

    if (!deletedBatch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Batch deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting batch:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getBatchesByCourse = async (req, res) => {
  try {
    const { course_id } = req.params;
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const batches = await Batch.find({ tenant_id, course_id })
      .populate("tenant_id", "name")
      .populate("course_id", "course_name")
      .populate("instructor_id", "name email")
      .sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      message: "Batches retrieved successfully",
      data: batches,
    });
  } catch (error) {
    console.error("Error fetching batches by course:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getBatchesByInstructor = async (req, res) => {
  try {
    const { instructor_id } = req.params;
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const batches = await Batch.find({
      tenant_id,
      $or: [
        { instructor_id },
        { instructor_ids: instructor_id }
      ]
    })
      .populate("tenant_id", "name")
      .populate("course_id", "course_title")
      .populate("instructor_id", "name email")
      .populate("instructor_ids", "name email")
      .sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      message: "Batches retrieved successfully",
      data: batches,
    });
  } catch (error) {
    console.error("Error fetching batches by instructor:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getMyBatches = async (req, res) => {
  try {
    const instructor_id = req.user.id || req.user._id;
    const tenant_id = req.user.tenant_id;

    console.log("Debug - User object:", {
      user_id: req.user._id,
      user_id_alt: req.user.id,
      tenant_id: req.user.tenant_id,
      role: req.user.role,
      email: req.user.email,
    });

    // Log all available user properties
    console.log("Debug - Full user object:", JSON.stringify(req.user, null, 2));

    // Validate instructor_id and tenant_id from user
    if (!instructor_id || !tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Instructor ID and Tenant ID are required",
      });
    }

    // First, let's check if there are any batches for this tenant
    const allBatchesForTenant = await Batch.find({ tenant_id });
    console.log("Debug - All batches for tenant:", allBatchesForTenant.length);
    if (allBatchesForTenant.length > 0) {
      console.log("Debug - Sample tenant batch:", {
        _id: allBatchesForTenant[0]._id,
        instructor_id: allBatchesForTenant[0].instructor_id,
        tenant_id: allBatchesForTenant[0].tenant_id,
      });
    }

    // Then check if there are any batches for this instructor
    const batchesForInstructor = await Batch.find({
      $or: [
        { instructor_id },
        { instructor_ids: instructor_id }
      ]
    });
    console.log(
      "Debug - All batches for instructor:",
      batchesForInstructor.length
    );
    if (batchesForInstructor.length > 0) {
      console.log("Debug - Sample instructor batch:", {
        _id: batchesForInstructor[0]._id,
        instructor_id: batchesForInstructor[0].instructor_id,
        instructor_ids: batchesForInstructor[0].instructor_ids,
        tenant_id: batchesForInstructor[0].tenant_id,
      });
    }

    // Now check with both conditions
    let batches = await Batch.find({
      tenant_id,
      $or: [
        { instructor_id },
        { instructor_ids: instructor_id }
      ]
    })
      .populate("tenant_id", "name")
      .populate("course_id", "course_title")
      .populate("instructor_id", "name email")
      .populate("instructor_ids", "name email")
      .sort({ created_at: -1 });

    // If no batches found, try with string conversion
    if (batches.length === 0) {
      console.log("Debug - Trying with string conversion...");
      batches = await Batch.find({
        tenant_id: tenant_id.toString(),
        $or: [
          { instructor_id: instructor_id.toString() },
          { instructor_ids: instructor_id.toString() }
        ]
      })
        .populate("tenant_id", "name")
        .populate("course_id", "course_title")
        .populate("instructor_id", "name email")
        .populate("instructor_ids", "name email")
        .sort({ created_at: -1 });
    }

    console.log("Debug - Final batches found:", batches.length);
    console.log("Debug - Search criteria:", { tenant_id, instructor_id });

    return res.status(200).json({
      success: true,
      message: "Your batches retrieved successfully",
      data: batches,
    });
  } catch (error) {
    console.error("Error fetching instructor's batches:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getActiveBatches = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const currentDate = new Date();

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const batches = await Batch.find({
      tenant_id,
      start_date: { $lte: currentDate },
      end_date: { $gte: currentDate },
      status: { $in: ["active"] },
    })
      .populate("tenant_id", "name")
      .populate("course_id", "course_name")
      .populate("instructor_id", "name email")
      .sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      message: "Active batches retrieved successfully",
      data: batches,
    });
  } catch (error) {
    console.error("Error fetching active batches:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getUpcomingBatches = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const currentDate = new Date();

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const batches = await Batch.find({
      tenant_id,
      start_date: { $gt: currentDate },
      status: { $in: ["active", "suspended"] },
    })
      .populate("tenant_id", "name")
      .populate("course_id", "course_name")
      .populate("instructor_id", "name email")
      .sort({ start_date: 1 });

    return res.status(200).json({
      success: true,
      message: "Upcoming batches retrieved successfully",
      data: batches,
    });
  } catch (error) {
    console.error("Error fetching upcoming batches:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getCompletedBatches = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const currentDate = new Date();

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const batches = await Batch.find({
      tenant_id,
      end_date: { $lt: currentDate },
      status: { $in: ["completed", "cancelled"] },
    })
      .populate("tenant_id", "name")
      .populate("course_id", "course_name")
      .populate("instructor_id", "name email")
      .sort({ end_date: -1 });

    return res.status(200).json({
      success: true,
      message: "Completed batches retrieved successfully",
      data: batches,
    });
  } catch (error) {
    console.error("Error fetching completed batches:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// search batches
export const searchBatches = async (req, res) => {
  try {
    const { searchValue } = req.params;
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const batches = await Batch.find({
      tenant_id,
      $or: [{ batch_name: { $regex: searchValue, $options: "i" } }],
    })
      .populate("tenant_id", "name")
      .populate("course_id", "course_name")
      .populate("instructor_id", "name email")
      .sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      message: "Batches search completed successfully",
      data: batches,
    });
  } catch (error) {
    console.error("Error searching batches:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getBatchCount = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const count = await Batch.countDocuments({ tenant_id });

    return res.status(200).json({
      success: true,
      message: "Batch count retrieved successfully",
      data: { count },
    });
  } catch (error) {
    console.error("Error getting batch count:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getBatchesByStatus = async (req, res) => {
  try {
    const { status } = req.params;
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    // Validate status
    const validStatuses = ["active", "suspended", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid status. Must be one of: active, suspended, completed, cancelled",
      });
    }

    const batches = await Batch.find({ tenant_id, status })
      .populate("tenant_id", "name")
      .populate("course_id", "course_name")
      .populate("instructor_id", "name email")
      .sort({ created_at: -1 });

    return res.status(200).json({
      success: true,
      message: `${status} batches retrieved successfully`,
      data: batches,
    });
  } catch (error) {
    console.error("Error fetching batches by status:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const toggleBatchStatus = async (req, res) => {
  try {
    const { batch_id } = req.params;
    const { status } = req.body;
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    // Validate status
    const validStatuses = ["active", "suspended", "completed", "cancelled"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Valid status is required. Must be one of: active, suspended, completed, cancelled",
      });
    }

    const updatedBatch = await Batch.findOneAndUpdate(
      { _id: batch_id, tenant_id },
      { status },
      { new: true, runValidators: true }
    ).populate([
      { path: "tenant_id", select: "name" },
      { path: "course_id", select: "course_title" },
      {
        path: "instructor_id",
        select: "email",
        populate: {
          path: "user_id",
          select: "fname lname",
        },
      },
    ]);

    if (!updatedBatch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Batch status updated to ${status} successfully`,
      data: updatedBatch,
    });
  } catch (error) {
    console.error("Error toggling batch status:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getBatchStatistics = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    // Validate tenant_id from user
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const stats = await Batch.aggregate([
      { $match: { tenant_id: new mongoose.Types.ObjectId(tenant_id) } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Format the statistics
    const formattedStats = {
      active: 0,
      suspended: 0,
      completed: 0,
      cancelled: 0,
      total: 0,
    };

    stats.forEach((stat) => {
      formattedStats[stat._id] = stat.count;
      formattedStats.total += stat.count;
    });

    return res.status(200).json({
      success: true,
      message: "Batch statistics retrieved successfully",
      data: formattedStats,
    });
  } catch (error) {
    console.error("Error getting batch statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get students for a specific batch (for instructors)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getBatchStudentsForInstructor = async (req, res) => {
  try {
    const { batch_id } = req.params;
    const instructor_id = req.user.id || req.user._id;
    const tenant_id = req.user.tenant_id;

    console.log('Debug - getBatchStudentsForInstructor:', {
      batch_id,
      instructor_id,
      tenant_id,
      user: req.user
    });

    if (!instructor_id || !tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Instructor ID and Tenant ID are required"
      });
    }

    // Verify that the batch belongs to this instructor
    const batch = await Batch.findOne({
      _id: batch_id,
      tenant_id,
      $or: [
        { instructor_id },
        { instructor_ids: instructor_id }
      ]
    });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found or access denied"
      });
    }

    // Get students enrolled in this batch
    const batchStudents = await BatchStudent.find({ batch_id })
      .populate({
        path: 'student_id',
        select: 'email user_id',
        populate: {
          path: 'user_id',
          select: 'fname lname email phone_number user_code'
        }
      })
      .populate('batch_id', 'batch_name course_id instructor_id instructor_ids start_date end_date status')
      .sort({ joined_at: -1 });

    console.log('Debug - Found batch students:', batchStudents.length);

    return res.status(200).json({
      success: true,
      message: "Batch students retrieved successfully",
      data: {
        batch: {
          _id: batch._id,
          batch_name: batch.batch_name,
          course_id: batch.course_id,
          start_date: batch.start_date,
          end_date: batch.end_date,
          status: batch.status
        },
        students: batchStudents
      }
    });

  } catch (error) {
    console.error("Error fetching batch students for instructor:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

/**
 * Get all students across all batches for an instructor
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getAllStudentsForInstructor = async (req, res) => {
  try {
    const instructor_id = req.user.id || req.user._id;
    const tenant_id = req.user.tenant_id;

    console.log('Debug - getAllStudentsForInstructor:', {
      instructor_id,
      tenant_id,
      user: req.user
    });

    if (!instructor_id || !tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Instructor ID and Tenant ID are required"
      });
    }

    // Get all batches where this instructor is assigned
    const instructorBatches = await Batch.find({
      tenant_id,
      $or: [
        { instructor_id },
        { instructor_ids: instructor_id }
      ]
    }).select('_id batch_name course_id start_date end_date status');

    if (instructorBatches.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No batches found for this instructor",
        data: []
      });
    }

    const batchIds = instructorBatches.map(batch => batch._id);

    // Get all students from all instructor's batches
    const allBatchStudents = await BatchStudent.find({
      batch_id: { $in: batchIds }
    })
      .populate({
        path: 'student_id',
        select: 'email user_id',
        populate: {
          path: 'user_id',
          select: 'fname lname email phone_number user_code'
        }
      })
      .populate({
        path: 'batch_id',
        select: 'batch_name course_id start_date end_date status',
        populate: {
          path: 'course_id',
          select: 'course_title'
        }
      })
      .sort({ joined_at: -1 });

    // Group students by batch for better organization
    const studentsByBatch = instructorBatches.map(batch => {
      const batchStudents = allBatchStudents.filter(
        student => student.batch_id._id.toString() === batch._id.toString()
      );

      return {
        batch_id: batch._id,
        batch_name: batch.batch_name,
        course_title: batch.course_id?.course_title || 'N/A',
        start_date: batch.start_date,
        end_date: batch.end_date,
        status: batch.status,
        students: batchStudents,
        student_count: batchStudents.length
      };
    });

    console.log('Debug - Found students across batches:', allBatchStudents.length);

    return res.status(200).json({
      success: true,
      message: "All students for instructor retrieved successfully",
      data: {
        total_students: allBatchStudents.length,
        total_batches: instructorBatches.length,
        students_by_batch: studentsByBatch
      }
    });

  } catch (error) {
    console.error("Error fetching all students for instructor:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};