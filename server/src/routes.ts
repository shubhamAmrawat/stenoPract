import { Router } from 'express';
import { requireAuth } from './middleware/auth.js';
import { adminRouter } from './modules/admin/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { attemptsRouter } from './modules/attempts/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { catalogRouter } from './modules/catalog/routes.js';
import { libraryRouter } from './modules/library/routes.js';
import { profileRouter } from './modules/profile/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { resourcesRouter } from './modules/resources/routes.js';

export const apiRouter = Router();

// Public: sign-in / sign-out. (Its own routes decide who may call them.)
apiRouter.use(authRouter);

// Everything below needs a signed-in student.
apiRouter.use(requireAuth);
apiRouter.use(profileRouter);
apiRouter.use(catalogRouter);
apiRouter.use(libraryRouter);
apiRouter.use(attemptsRouter);
apiRouter.use(analyticsRouter);
apiRouter.use(reportsRouter);
apiRouter.use(resourcesRouter);

// Admins only.
apiRouter.use('/admin', adminRouter);
