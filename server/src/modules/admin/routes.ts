import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { adminAccessRouter } from './access.js';
import { adminConfigRouter } from './config.js';
import { adminContentRouter } from './content.js';
import { adminReportsRouter } from './reports.js';
import { adminResourcesRouter } from './resources.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);
adminRouter.use(adminContentRouter);
adminRouter.use(adminConfigRouter);
adminRouter.use(adminReportsRouter);
adminRouter.use(adminResourcesRouter);
adminRouter.use(adminAccessRouter);
