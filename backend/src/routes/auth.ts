import { Router } from 'express';
import { registerUser, loginUser } from '../services/auth';
import { ApiError } from '../middleware/errors';

const router = Router();

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body ?? {};
  if (!name || !email || !password) {
    throw new ApiError(400, 'VALIDATION', 'name, email and password are required');
  }
  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, 'VALIDATION', 'name, email and password must be strings');
  }
  if (password.length < 8) {
    throw new ApiError(400, 'VALIDATION', 'password must be at least 8 characters long');
  }
  res.status(201).json(await registerUser(name, email, password));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    throw new ApiError(400, 'VALIDATION', 'email and password are required');
  }
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(400, 'VALIDATION', 'email and password must be strings');
  }
  res.json(await loginUser(email, password));
});

export default router;
