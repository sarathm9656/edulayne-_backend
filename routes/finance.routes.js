import express from 'express';
import {
    getTenantFinancialSummary,
    getInstructorAnalytics,
    getMyEarnings,
    getTenantLogs,
    getInstructorLogs,
    syncDyteSessions
} from '../controllers/finance.controller.js';

const router = express.Router();

// Middleware for authentication
import { tenantMiddleware as protect } from '../middleware/tenant.middleware.js';

// ==========================================
// TENANT (ADMIN) ROUTES
// ==========================================
router.get('/tenant/summary/:tenantId', getTenantFinancialSummary);
router.get('/tenant/instructors/:tenantId', getInstructorAnalytics);
router.get('/tenant/logs/:tenantId', getTenantLogs);
router.post('/tenant/sync/dyte', syncDyteSessions);

// ==========================================
// INSTRUCTOR ROUTES
// ==========================================
router.get('/instructor/my-earnings', protect, getMyEarnings);
router.get('/instructor/logs', protect, getInstructorLogs);

export default router;
