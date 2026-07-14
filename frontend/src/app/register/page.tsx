'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { setToken } from '@/lib/auth';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/auth/register', { method: 'POST', body: { name, email, password } });
      const { token } = await api<{ token: string }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setToken(token);
      router.push('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-omarchy border border-border bg-surface p-6">
        <h1 className="text-xl font-semibold text-fg">Create account</h1>
        {error && <p className="rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">{error}</p>}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-fg">
            Name
          </label>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-fg">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-fg">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-omarchy border border-border bg-surface-2 px-2 py-1 text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-omarchy bg-accent py-2 font-medium text-bg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Create account
        </button>
        <p className="text-sm text-fg-muted">
          Already registered?{' '}
          <Link href="/login" className="text-accent underline">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
