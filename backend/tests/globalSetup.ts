import { execSync } from 'node:child_process';

export default function setup() {
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
