import Role from "../../models/role.model.js";
import mongoose from "mongoose";
import Login from "../../models/login.model.js";
import User from "../../models/user.model.js";
import Course from "../../models/Course.js";
import CoursePurchase from "../../models/Course_Purchase.js";
import BatchStudent from "../../models/Batch_Students.js";
import Batch from "../../models/Batch_table.js";
import LiveSession from "../../models/Live_Session.model.js";
import { findBatchConflict } from "../../utils/batchConflict.js";
import QuizResult from "../../models/QuizResult.js";

export async function getStudents(req, res) {
  try {
    const { tenant_id } = req.user;
    const { course_id } = req.params; // Changed to course_id for course enrollment

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    // Step 1: Get student role_id from Role model
    const studentRole = await Role.findOne({ name: "student" });

    if (!studentRole) {
      return res.status(404).json({
        success: false,
        message: "Student role not found",
      });
    }

    const studentRoleId = studentRole._id;

    // Step 2: Get login data from Login model based on role_id and tenant_id
    const loginRecords = await Login.find({
      role_id: studentRoleId,
      tenant_id: tenant_id,
    }).populate("user_id").sort({ createdAt: -1 });

    if (!loginRecords || loginRecords.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No students found for this tenant",
        all_students: [],
        coursePurchasedStudents: [],
        coursePurchasedStudentsCount: 0,
      });
    }

    // Step 3: Extract user_ids and fetch complete user data from User model
    const userIds = loginRecords.map((login) => login.user_id._id);
    const students = await User.find({
      _id: { $in: userIds },
    });

    // Step 4: Combine the data for all students
    const allStudentData = students.map((student) => {
      const loginRecord = loginRecords.find(
        (login) => login.user_id._id.toString() === student._id.toString()
      );

      return {
        _id: student._id, // Use User ID as primary ID
        login_id: loginRecord._id, // Include Login ID for enrollment
        fname: student.fname,
        lname: student.lname,
        email: student.email,
        phone_number: student.phone_number,
        age: student.age,
        dob: student.dob,
        // ✅ Expose generated student code so frontend can display it
        user_code: student.user_code,
        tenant_id: tenant_id,
        role_id: studentRoleId,
        is_active: loginRecord ? loginRecord.is_active : false,
        created_at: student.createdAt,
        updated_at: student.updatedAt,
      };
    });

    // Step 5: Get course students if course_id is provided
    let courseStudents = [];
    let courseStudentsCount = 0;

    if (course_id) {
      courseStudents = await CoursePurchase.find({
        course_id: course_id,
      }).populate("user_id");

      courseStudentsCount = courseStudents.length;

      // --- New: Fetch Batch Info ---
      const batches = await Batch.find({ course_id: course_id }).select('_id batch_name');
      const batchIds = batches.map((b) => b._id);

      const batchEnrollments = await BatchStudent.find({
        batch_id: { $in: batchIds },
        student_id: { $in: loginRecords.map((l) => l._id) },
      }).populate("batch_id", "batch_name");
      // --- End New ---

      // Convert to match expected format
      courseStudents = courseStudents.map((enrollment) => {
        const studentData = allStudentData.find(
          (student) =>
            student._id.toString() === enrollment.user_id._id.toString()
        );

        // Find batch info
        const studentBatch = batchEnrollments.find(
          (be) => be.student_id.toString() === studentData?.login_id?.toString()
        );

        return {
          _id: enrollment._id,
          course_id: enrollment.course_id,
          user_id: enrollment.user_id._id, // User ID for consistency
          login_id: studentData?.login_id, // Login ID for enrollment
          student_data: enrollment.user_id,
          purchased_at: enrollment.purchased_at,
          batch_name: studentBatch ? studentBatch.batch_id.batch_name : null,
          batch_id: studentBatch ? studentBatch.batch_id._id : null,
        };
      });
    }


    return res.status(200).json({
      success: true,
      message: "Students fetched successfully",
      all_students: allStudentData,
      coursePurchasedStudents: courseStudents,
      coursePurchasedStudentsCount: courseStudentsCount,
      all_count: allStudentData.length,
      batchStudentsCount: courseStudentsCount,
    });
  } catch (error) {
    console.error("Error fetching students:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch students",
      error: error.message,
    });
  }
}

export async function getStudentById(req, res) {
  try {
    const { tenant_id } = req.user;
    const { id: userId } = req.params;

    if (!tenant_id || !userId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID and User ID are required",
      });
    }

    // Step 1: Get user data
    const student = await User.findById(userId);
    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found",
      });
    }

    // Step 2: Get login info to verify tenant
    const loginRecord = await Login.findOne({
      user_id: userId,
      tenant_id: tenant_id
    });

    if (!loginRecord) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Student does not belong to this tenant.",
      });
    }

    // Step 3: Get enrolled courses
    const enrolledCourses = await CoursePurchase.find({
      user_id: userId,
      tenant_id: tenant_id
    }).populate("course_id");

    // Step 4: Get enrolled batches
    const enrolledBatches = await BatchStudent.find({
      student_id: loginRecord._id
    }).populate({
      path: "batch_id",
      populate: { path: "course_id" }
    });

    return res.status(200).json({
      success: true,
      data: {
        ...student.toObject(),
        login_id: loginRecord._id,
        is_active: loginRecord.is_active,
        enrolledCourses: enrolledCourses.map(e => ({
          purchase_id: e._id,
          purchased_at: e.purchased_at,
          ...(e.course_id?.toObject() || {})
        })),
        enrolledBatches: enrolledBatches.map(e => ({
          enrollment_id: e._id,
          joined_at: e.joined_at,
          status: e.status,
          progress: e.progress,
          ...(e.batch_id?.toObject() || {})
        }))
      }
    });
  } catch (error) {
    console.error("Error fetching student details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch student details",
      error: error.message,
    });
  }
}

export async function updateStudentEnrollments(req, res) {
  try {
    const { tenant_id } = req.user;
    const { id: userId } = req.params;
    const { courseIds, batchIds } = req.body;

    if (!tenant_id || !userId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID and User ID are required",
      });
    }

    // Verify tenant and get login_id
    const loginRecord = await Login.findOne({ user_id: userId, tenant_id });
    if (!loginRecord) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const now = new Date();
    let enrollmentErrors = [];

    // 1. Update Course Enrollments
    if (courseIds && Array.isArray(courseIds)) {
      // Remove courses not in the list
      await CoursePurchase.deleteMany({
        user_id: userId,
        tenant_id: tenant_id,
        course_id: { $nin: courseIds }
      });

      // Add new courses
      const existingPurchases = await CoursePurchase.find({
        user_id: userId,
        course_id: { $in: courseIds }
      }).distinct("course_id");

      const coursesToAdd = courseIds.filter(id => !existingPurchases.map(eid => eid.toString()).includes(id.toString()));

      if (coursesToAdd.length > 0) {
        const newPurchases = coursesToAdd.map(courseId => ({
          user_id: userId,
          course_id: courseId,
          tenant_id: tenant_id,
          purchased_at: now
        }));
        await CoursePurchase.insertMany(newPurchases, { ordered: false }).catch(() => { });
      }
    }

    // 2. Update Batch Enrollments
    if (batchIds && Array.isArray(batchIds)) {
      // Remove batches not in the list
      await BatchStudent.deleteMany({
        student_id: loginRecord._id,
        batch_id: { $nin: batchIds }
      });

      // Add new batches
      const existingBatchEnrollments = await BatchStudent.find({
        student_id: loginRecord._id,
        batch_id: { $in: batchIds }
      }).distinct("batch_id");

      const batchesToAdd = batchIds.filter(id => !existingBatchEnrollments.map(bid => bid.toString()).includes(id.toString()));

      if (batchesToAdd.length > 0) {
        const batchesToAddDocs = await Batch.find({ _id: { $in: batchesToAdd } });
        const newBatchEnrollments = [];

        // Check conflicts for each batch
        for (const batch of batchesToAddDocs) {
          const studentActiveEnrollments = await BatchStudent.find({
            student_id: loginRecord._id,
            status: "active"
          }).populate("batch_id");

          const existingBatches = studentActiveEnrollments.map(e => e.batch_id);
          // Also add already approved new enrollments to the check set to preventing self-conflict in this request
          // (e.g. adding Batch A and Batch B where A and B conflict)
          const pendingBatches = newBatchEnrollments.map(e => batchesToAddDocs.find(b => b._id.toString() === e.batch_id.toString()));

          const conflict = findBatchConflict(batch, [...existingBatches, ...pendingBatches]);

          if (!conflict) {
            newBatchEnrollments.push({
              student_id: loginRecord._id,
              batch_id: batch._id,
              joined_at: now,
              status: "active"
            });
          } else {
            enrollmentErrors.push(`Skipping batch ${batch.batch_name} for student ${userId} due to conflict with ${conflict.batch_name}`);
          }
        }

        if (newBatchEnrollments.length > 0) {
          await BatchStudent.insertMany(newBatchEnrollments, { ordered: false }).catch(() => { });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Student enrollments updated successfully" + (enrollmentErrors.length > 0 ? ` with ${enrollmentErrors.length} warnings.` : ""),
      warnings: enrollmentErrors
    });
  } catch (error) {
    console.error("Error updating student enrollments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update student enrollments",
      error: error.message,
    });
  }
}

export async function EnrollStudents(req, res) {
  try {
    const { tenant_id } = req.user;
    const { batch_id } = req.params;
    console.log("batch_id", batch_id)
    console.log("tenant_id", tenant_id)
    console.log("===============")



    const { courseStudents } = req.body; // Array of { user_id }

    if (!batch_id || !Array.isArray(courseStudents)) {
      return res.status(400).json({
        success: false,
        message: "Batch ID and courseStudents array are required",
      });
    }

    const batch = await Batch.findById(batch_id).populate('course_id');
    console.log("batch found", batch);
    console.log("Batch enrollment request:", { batch });

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch not found or access denied",
      });
    }

    // Enrollment timing and status checks
    const currentDate = new Date();
    if (new Date(batch.end_date) < currentDate) {
      return res.status(400).json({
        success: false,
        message: "Cannot enroll students. This batch has already ended.",
      });
    }

    if (!batch.course_id || !batch.course_id.is_active) {
      return res.status(400).json({
        success: false,
        message: "Cannot enroll students. The associated course is inactive or expired.",
      });
    }

    // Get current enrollment count for this batch
    const currentEnrollmentCount = await BatchStudent.countDocuments({
      batch_id: batch_id,
    });

    // Extract user_ids from courseStudents (frontend sends user_id)
    const userIds = courseStudents.map((obj) => obj.user_id);

    // Find already enrolled students
    const alreadyEnrolled = await BatchStudent.find({
      student_id: { $in: userIds },
      batch_id: batch_id,
    }).distinct("student_id");

    // Filter out already enrolled students
    const newUserIds = userIds.filter((id) => !alreadyEnrolled.includes(id));
    console.log("New students to enroll:", newUserIds);

    // Check if adding new students would exceed max_enrollment (if batch has a limit)
    // You can add batch enrollment limit logic here if needed
    // const newEnrollmentCount = currentEnrollmentCount + newUserIds.length;
    // if (batch.max_enrollment && newEnrollmentCount > batch.max_enrollment) {
    //   return res.status(400).json({
    //     success: false,
    //     message: `Cannot enroll students. Batch has a maximum enrollment limit of ${batch.max_enrollment}.`
    //   });
    // }

    const now = new Date();

    // Prepare docs for new batch enrollments
    const batchStudentDocs = newUserIds.map((studentId) => ({
      batch_id: batch_id,
      student_id: studentId,
      joined_at: now,
      status: "active",
    }));

    // Insert only new enrollments
    let inserted = [];
    let errors = [];
    if (batchStudentDocs.length > 0) {
      try {
        const result = await BatchStudent.insertMany(batchStudentDocs, {
          ordered: false,
        });
        inserted = result.map((doc) => doc.student_id);
      } catch (err) {
        errors = err.writeErrors
          ? err.writeErrors.map((e) => e.errmsg)
          : [err.message];
      }
    }

    // Remove enrollments for students NOT in courseStudents
    await BatchStudent.deleteMany({
      batch_id: batch_id,
      student_id: { $nin: userIds },
    });

    // Get updated enrollment count
    const updatedEnrollmentCount = await BatchStudent.countDocuments({
      batch_id: batch_id,
    });

    return res.status(200).json({
      success: true,
      message: "Students enrolled/unenrolled in batch successfully",
      enrolled_students: inserted,
      skipped_students: alreadyEnrolled,
      currentEnrollment: updatedEnrollmentCount,
      maxEnrollment: batch.max_enrollment || null,
      batch_name: batch.batch_name,
      errors,
    });
  } catch (error) {
    console.error("Batch enrollment error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while enrolling students in batch",
      error: error.message,
    });
  }
}

export async function EnrollStudentsInCourse(req, res) {
  try {
    const { tenant_id } = req.user;
    const { course_id } = req.params;
    const { courseStudents, batch_id } = req.body; // array of objects: [{ user_id }] + optional batch_id

    console.log("Course enrollment request:", { course_id, courseStudents, batch_id });

    if (!tenant_id || !course_id || !Array.isArray(courseStudents)) {
      return res.status(400).json({
        success: false,
        message: "Missing tenant_id, course_id, or courseStudents array",
      });
    }

    // First, get the course details to check if it exists and belongs to tenant
    const course = await Course.findOne({ _id: course_id, tenant_id });

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found or access denied",
      });
    }

    // Enrollment timing and status checks
    const currentDate = new Date();
    if (course.end_date && new Date(course.end_date) < currentDate) {
      return res.status(400).json({
        success: false,
        message: "Cannot enroll students. This course has already ended.",
      });
    }

    if (!course.is_active) {
      return res.status(400).json({
        success: false,
        message: "Cannot enroll students. The course is currently inactive.",
      });
    }

    // Get current enrollment count for this course
    const currentEnrollmentCount = await CoursePurchase.countDocuments({
      course_id: course_id,
    });

    // Extract user_ids from courseStudents
    const userIds = courseStudents.map((obj) => obj.user_id);

    // Find already enrolled students
    const alreadyEnrolled = await CoursePurchase.find({
      user_id: { $in: userIds },
      course_id: course_id,
    }).distinct("user_id");

    // Filter out already enrolled students
    const newUserIds = userIds.filter((id) => !alreadyEnrolled.includes(id));
    console.log("New students to enroll:", newUserIds);

    // Check if adding new students would exceed max_enrollment
    const newEnrollmentCount = currentEnrollmentCount + newUserIds.length;
    if (course.max_enrollment && newEnrollmentCount > course.max_enrollment) {
      return res.status(400).json({
        success: false,
        message: `Cannot enroll students. Course has a maximum enrollment limit of ${course.max_enrollment
          }. Current: ${currentEnrollmentCount}, Adding: ${newUserIds.length
          }, Would exceed by: ${newEnrollmentCount - course.max_enrollment}`,
        currentEnrollment: currentEnrollmentCount,
        maxEnrollment: course.max_enrollment,
        studentsToAdd: newUserIds.length,
        wouldExceedBy: newEnrollmentCount - course.max_enrollment,
      });
    }

    const now = new Date();

    // Prepare docs for new course enrollments
    const coursePurchaseDocs = newUserIds.map((userId) => ({
      user_id: userId,
      course_id: course_id,
      tenant_id: tenant_id,
      purchased_at: now,
    }));

    // Insert only new enrollments
    let inserted = [];
    let errors = [];
    if (coursePurchaseDocs.length > 0) {
      try {
        const result = await CoursePurchase.insertMany(coursePurchaseDocs, {
          ordered: false,
        });
        inserted = result.map((doc) => doc.user_id);
      } catch (err) {
        errors = err.writeErrors
          ? err.writeErrors.map((e) => e.errmsg)
          : [err.message];
      }
    }

    // Remove enrollments for students NOT in courseStudents
    // Note: This effectively "unenrolls" students if they are unchecked in the UI
    await CoursePurchase.deleteMany({
      course_id: course_id,
      user_id: { $nin: userIds },
    });

    // --- Batch Enrollment Logic ---
    if (batch_id) {
      // Find the student's login_id (needed for BatchStudent)
      // BatchStudent uses 'student_id' which is typically reference to Login or User?
      // Looking at getStudentById, BatchStudent.student_id seems to be Login._id ("student_id: loginRecord._id")
      // But in getStudents, it links it via login_id.
      // Let's verify BatchStudent model... It refers to 'Login' usually in this codebase based on other controllers.
      // Yes, BatchSchema 'instructor_id' refs 'Login'. BatchStudent 'student_id' likely refs 'Login' too?
      // Let's check getStudents function: "student_id: { $in: loginRecords.map((l) => l._id) }"
      // So yes, we need Login IDs.

      const studentRole = await Role.findOne({ name: "student" });
      const loginRecords = await Login.find({
        user_id: { $in: userIds }, // All currently selected students
        tenant_id: tenant_id,
        role_id: studentRole._id
      });

      const loginIds = loginRecords.map(l => l._id);

      // Enroll these logins into the batch
      // First check if already enrolled in this batch
      const alreadyInBatch = await BatchStudent.find({
        batch_id: batch_id,
        student_id: { $in: loginIds }
      }).distinct("student_id");

      const newBatchLogins = loginIds.filter(id => !alreadyInBatch.map(a => a.toString()).includes(id.toString()));

      if (newBatchLogins.length > 0) {
        const targetBatch = await Batch.findById(batch_id);
        const batchDocs = [];

        // Loop through students to check for conflicts individually
        for (const loginId of newBatchLogins) {
          const studentActiveEnrollments = await BatchStudent.find({
            student_id: loginId,
            status: "active"
          }).populate("batch_id");

          const existingBatches = studentActiveEnrollments.map(e => e.batch_id).filter(b => b && b._id.toString() !== batch_id);

          const conflict = findBatchConflict(targetBatch, existingBatches);

          if (!conflict) {
            batchDocs.push({
              batch_id: batch_id,
              student_id: loginId,
              joined_at: now,
              status: "active"
            });
          } else {
            // We can collect errors if we want to report them
            errors.push(`Student skipped from batch: Conflict with ${conflict.batch_name}`);
          }
        }

        if (batchDocs.length > 0) {
          await BatchStudent.insertMany(batchDocs, { ordered: false }).catch(err => console.error("Batch insert error", err));
        }
      }

      // We do NOT unenroll from batch here because unticking a course shouldn't necessarily remove from batch? 
      // Or should it? The user said "student if add a couse to a pssible to add a student add in a batch".
      // If I uncheck a student from course, I arguably should remove them from batches of that course.
      // But keeping it simple: just Add for now.
    }
    // -----------------------------

    // Get updated enrollment count
    const updatedEnrollmentCount = await CoursePurchase.countDocuments({
      course_id: course_id,
    });

    return res.status(200).json({
      success: true,
      message: "Students enrolled in course (and batch) successfully",
      enrolled_students: inserted,
      skipped_students: alreadyEnrolled,
      currentEnrollment: updatedEnrollmentCount,
      maxEnrollment: course.max_enrollment,
      course_title: course.course_title,
      errors,
    });
  } catch (error) {
    console.error("Course enrollment error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while enrolling students in course",
      error: error.message,
    });
  }
}

export const getTenantStats = async (req, res) => {
  console.log("getTenantStats function called!");
  console.log("Request user:", req.user);
  try {
    const { tenant_id } = req.user;

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    // Get student role
    const studentRole = await Role.findOne({ name: "student" });
    const instructorRole = await Role.findOne({ name: "instructor" });

    if (!studentRole || !instructorRole) {
      return res.status(404).json({
        success: false,
        message: "Required roles not found",
      });
    }

    // Get counts using Promise.all for better performance
    const [
      studentsCount,
      instructorsCount,
      coursesCount,
      liveSessionsCount
    ] = await Promise.all([
      // Count students
      Login.countDocuments({
        tenant_id: tenant_id,
        role_id: studentRole._id,
        is_active: true
      }),

      // Count instructors
      Login.countDocuments({
        tenant_id: tenant_id,
        role_id: instructorRole._id,
        is_active: true
      }),

      // Count active courses
      Course.countDocuments({
        tenant_id: tenant_id,
        is_active: true,
        is_archived: false
      }),

      // Count live sessions for this tenant
      LiveSession.countDocuments({
        tenant_id: tenant_id,
        status: { $in: ['scheduled', 'ongoing', 'completed'] }
      })
    ]);

    console.log("=================")
    console.log("studentsCount", studentsCount)
    console.log("instructorsCount", instructorsCount)
    console.log("coursesCount", coursesCount)
    console.log("liveSessionsCount", liveSessionsCount)

    res.status(200).json({
      success: true,
      data: {
        students: studentsCount,
        instructors: instructorsCount,
        courses: coursesCount,
        liveSessions: liveSessionsCount
      }
    });

  } catch (error) {
    console.error("Error fetching tenant stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching tenant statistics",
      error: error.message,
    });
  }
};

export const getLiveSessionsCount = async (req, res) => {
  console.log("getLiveSessionsCount function called!");
  try {
    const { tenant_id } = req.user;

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    // Count live sessions for this tenant
    const liveSessionsCount = await LiveSession.countDocuments({
      tenant_id: tenant_id,
      status: { $in: ['scheduled', 'ongoing', 'completed'] }
    });

    console.log("Live sessions count for tenant:", tenant_id, "=", liveSessionsCount);

    res.status(200).json({
      success: true,
      data: {
        liveSessions: liveSessionsCount
      }
    });

  } catch (error) {
    console.error("Error fetching live sessions count:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching live sessions count",
      error: error.message,
    });
  }
};

export const getDashboardAnalytics = async (req, res) => {
  try {
    const { tenant_id } = req.user;

    if (!tenant_id) {
      return res.status(400).json({ success: false, message: "Tenant ID required" });
    }

    // 1. Get all courses for this tenant (to filter results)
    const tenantCourses = await Course.find({ tenant_id }).select('_id course_title');
    const tenantCourseIds = tenantCourses.map(c => c._id);

    // 2. Learning Activity (Quiz Submissions over last 7 days)
    const learningActivity = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const startOfDay = new Date(d);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(d);
      endOfDay.setHours(23, 59, 59, 999);

      const count = await QuizResult.countDocuments({
        course_id: { $in: tenantCourseIds },
        completed_at: { $gte: startOfDay, $lte: endOfDay }
      });
      learningActivity.push(count);
    }

    // 3. Overall Performance
    const performanceStats = await QuizResult.aggregate([
      { $match: { course_id: { $in: tenantCourseIds } } },
      {
        $group: {
          _id: null,
          avgScore: { $avg: "$percentage" },
          totalQuizzes: { $sum: 1 }
        }
      }
    ]);

    const avgScore = performanceStats.length > 0 ? Math.round(performanceStats[0].avgScore) : 0;

    // Participation Rate (Students who have taken at least one quiz vs Total Students)
    const uniqueParticipants = await QuizResult.distinct("student_id", {
      course_id: { $in: tenantCourseIds }
    });

    // Get total active students
    const studentRole = await Role.findOne({ name: "student" });
    const totalStudents = await Login.countDocuments({
      tenant_id,
      role_id: studentRole._id,
      is_active: true
    });

    const participationRate = totalStudents > 0
      ? Math.round((uniqueParticipants.length / totalStudents) * 100)
      : 0;


    // 4. Course Overview (Top 5 courses by enrollment)
    const topCourses = await CoursePurchase.aggregate([
      { $match: { tenant_id: new mongoose.Types.ObjectId(tenant_id) } },
      { $group: { _id: "$course_id", students: { $sum: 1 } } },
      { $sort: { students: -1 } },
      { $limit: 5 },
      { $lookup: { from: "courses", localField: "_id", foreignField: "_id", as: "course" } },
      { $unwind: "$course" },
      { $project: { _id: 1, title: "$course.course_title", students: 1, category: "$course.category_id" } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        learningActivity, // Array of 7 numbers
        overallPerformance: {
          avgScore,
          participationRate
        },
        topCourses
      }
    });

  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ success: false, message: "Error fetching analytics", error: error.message });
  }
};
