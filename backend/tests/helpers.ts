import { prisma } from '../src/db';
import request from 'supertest';
import type { Express } from 'express';

export { prisma };

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE audit_log, ticket_status_history, tickets, labels, phases, kanban_columns, projects, project_code_counter, users RESTART IDENTITY CASCADE',
  );
}

export async function authHeader(app: Express): Promise<{ Authorization: string }> {
  await request(app)
    .post('/api/v1/auth/register')
    .send({ name: 'Test User', email: 'test@test.com', password: 'secret123' });
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'test@test.com', password: 'secret123' });
  return { Authorization: `Bearer ${res.body.token}` };
}
