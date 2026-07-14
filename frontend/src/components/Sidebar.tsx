'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import type { Project } from '@/lib/types';

export default function Sidebar() {
  const pathname = usePathname();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    api<Project[]>('/projects')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, [pathname]);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="border-b border-border p-4 text-lg font-bold text-accent">Lumberjack Tasks</div>
      <nav className="flex-1 overflow-y-auto p-2">
        <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-fg-faint">Projects</p>
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className={`block rounded px-2 py-1 text-sm hover:bg-surface-2 ${
                  pathname === `/projects/${p.id}` ? 'bg-surface-2 font-medium text-accent' : ''
                }`}
              >
                {p.name}
                <span className="ml-1 text-xs text-fg-faint">{p.code}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-1 border-t border-border p-2">
        <Link href="/projects?new=1" className="block rounded px-2 py-1 text-sm hover:bg-surface-2">
          + New project
        </Link>
        <Link href="/settings" className="block rounded px-2 py-1 text-sm hover:bg-surface-2">
          Settings
        </Link>
        <Link href="/reports" className="block rounded px-2 py-1 text-sm hover:bg-surface-2">
          Reports
        </Link>
        <Link href="/projects" className="block rounded px-2 py-1 text-sm hover:bg-surface-2">
          All projects
        </Link>
      </div>
    </aside>
  );
}
