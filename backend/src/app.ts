import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler } from './middleware/errors';
import authRoutes from './routes/auth';
import { requireAuth } from './middleware/auth';
import projectRoutes from './routes/projects';
import columnRoutes from './routes/columns';
import labelRoutes from './routes/labels';
import phaseRoutes from './routes/phases';
import projectTicketRoutes from './routes/projectTickets';
import ticketRoutes from './routes/tickets';
import reportRoutes from './routes/reports';
import eventRoutes from './routes/events';
import gitHistoryRoutes from './routes/gitHistory';

// A tight limiter guards the credential endpoints against brute force / credential stuffing.
// The cap is env-configurable so the test suite can drive it without waiting on a real window.
function createAuthRateLimiter() {
  return rateLimit({
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    limit: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } },
  });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/auth', createAuthRateLimiter(), authRoutes);
  app.use('/api/v1/events', eventRoutes); // SSE; verifies its own token (query param)
  app.use('/api/v1', requireAuth); // everything below requires a valid JWT

  app.use('/api/v1/reports', reportRoutes);
  app.use('/api/v1/projects', projectRoutes);
  app.use('/api/v1/projects/:projectId/columns', columnRoutes);
  app.use('/api/v1/projects/:projectId/labels', labelRoutes);
  app.use('/api/v1/projects/:projectId/phases', phaseRoutes);
  app.use('/api/v1/projects/:projectId/tickets', projectTicketRoutes);
  app.use('/api/v1/projects/:projectId/git-history', gitHistoryRoutes);
  app.use('/api/v1/tickets', ticketRoutes);

  app.use(errorHandler);
  return app;
}
