import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { subscribeEvents } from '../services/events';

const HEARTBEAT_MS = 25_000;

const router = Router();

// SSE endpoint. EventSource cannot send an Authorization header, so the JWT
// arrives as a query parameter and is verified here instead of by requireAuth.
router.get('/', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || payload === null || typeof payload.sub !== 'string') {
      throw new Error('invalid payload');
    }
  } catch {
    res
      .status(401)
      .json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or missing token' } });
    return;
  }

  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const unsubscribe = subscribeEvents((event) => {
    if (projectId && event.projectId && event.projectId !== projectId) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
