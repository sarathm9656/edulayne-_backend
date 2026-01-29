import express from "express";
import superAdminAuthRoutes from "./auth/superAdminAuth.routes.js";
import tenantRoutes from "./tenant/tenant.routes.js";
import permissionRoutes from "./permissions/permission.routes.js";
import roleRoutes from "./role.routes.js";
import userRoutes from "./user/user.routes.js";
import courseRoutes from "./courses/course.routes.js";
import moduleRoutes from "./courses/module.routes.js";
import lessonRoutes from "./courses/lesson.routes.js";
import quizRoutes from "./courses/quiz.routes.js";
import { isSuperAdmin } from "../middleware/isSuperAdmin.js";
import instructorRoutes from "./instrucrtors/instructor.routes.js";
import categoryRoutes from "./courses/category.routes.js";
import subCategoryRoutes from "./courses/subcatgory.routes.js";
import superAdminRoutes from "./super-admin/super.admin.routes.js";
import authRoutes from "./auth/auth.routes.js";
import tenantForgotPasswordRoutes from "./auth/tenantForgotPassword.routes.js";
import levelRoutes from "./courses/level.routes.js";
import languageRoutes from "./courses/language.routes.js";
import meetingRoutes from "./meetings/meetings.routes.js";
import batchRoutes from "./batch/batch.routes.js";
import batchStudentRoutes from "./batch/batchstudent.routes.js";
import batchSubscriptionRoutes from "./batch/batchSubscription.routes.js";
import payrollRoutes from "./tenant/payroll.routes.js";
import attendanceRoutes from "./attendance.js";
import financeRoutes from "./finance.routes.js";

const router = express.Router();

router.use("/auth/superadmin", superAdminAuthRoutes);


router.use("/auth", authRoutes);

router.use("/auth", tenantForgotPasswordRoutes);

router.use("/tenants", tenantRoutes);

router.use("/permissions", permissionRoutes);

router.use("/roles", roleRoutes);

router.use("/users", userRoutes);

router.use("/courses", courseRoutes);

router.use("/categories", categoryRoutes);

router.use("/subcategories", subCategoryRoutes);

router.use("/superadmin", superAdminRoutes);

router.use("/modules", moduleRoutes);

router.use("/lessons", lessonRoutes);

router.use("/quizzes", quizRoutes);

router.use("/instructors", instructorRoutes);

router.use("/levels", levelRoutes);

router.use("/languages", languageRoutes);

router.use("/meetings", meetingRoutes);

router.use("/batch", batchRoutes);

router.use("/batch-student", batchStudentRoutes);

router.use("/batch-subscription", batchSubscriptionRoutes);

router.use("/payroll", payrollRoutes);

router.use("/attendance", attendanceRoutes);

router.use("/finance", financeRoutes);

export default router;
