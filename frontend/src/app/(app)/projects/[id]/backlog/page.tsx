'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { BacklogItem, BacklogPage as BacklogData, ProjectDetail } from '@/lib/types';
import { useLiveEvents } from '@/lib/useLiveEvents';
import TicketDetailModal from '@/components/TicketDetailModal';

const SORTABLE = ['id', 'name', 'description', 'status', 'label'] as const;
type SortKey = (typeof SORTABLE)[number];

function TicketRow({
  item,
  depth,
  onOpen,
}: {
  item: BacklogItem;
  depth: number;
  onOpen: (id: string) => void;
}) {
  return (
    <tr onClick={() => onOpen(item.id)} className="cursor-pointer border-b border-border hover:bg-surface-2">
      <td className="p-2" style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
        {depth > 0 ? '↳ ' : ''}#{item.number}
      </td>
      <td className="p-2">{item.name}</td>
      <td className="p-2 text-fg-muted">{item.description}</td>
      <td className="p-2">
        {item.completed ? (
          <span className="rounded-omarchy border border-border bg-surface-2 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
            {item.status}
          </span>
        ) : (
          item.status
        )}
      </td>
      <td className="p-2">{item.label ?? '—'}</td>
    </tr>
  );
}

export default function BacklogPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [data, setData] = useState<BacklogData | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('id');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    api<ProjectDetail>(`/projects/${id}`).then(setProject).catch(() => setProject(null));
  }, [id]);

  const load = useCallback(async () => {
    try {
      setData(
        await api<BacklogData>(
          `/projects/${id}/backlog?sortBy=${sortBy}&order=${order}&page=${page}&pageSize=50`,
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backlog');
    }
  }, [id, sortBy, order, page]);

  useEffect(() => {
    load();
  }, [load]);

  useLiveEvents(id, load);

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setOrder('asc');
    }
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Backlog{project ? ` — ${project.name}` : ''}</h1>
        <Link href={`/projects/${id}`} className="rounded-omarchy border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:border-accent">
          Back to board
        </Link>
      </div>
      {error && <p className="mb-3 rounded-omarchy border border-danger bg-surface p-2 text-sm text-danger">{error}</p>}
      <table className="w-full border-collapse rounded-omarchy border border-border bg-surface text-sm">
        <thead>
          <tr className="border-b border-border text-left text-fg-muted">
            {SORTABLE.map((key) => (
              <th key={key} className="p-2">
                <button
                  onClick={() => toggleSort(key)}
                  className="font-semibold capitalize hover:underline"
                  aria-label={key === 'id' ? 'ID' : key}
                >
                  {key === 'id' ? 'ID' : key}
                  {sortBy === key ? (order === 'asc' ? ' ▲' : ' ▼') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        {data?.groups.map((group) => {
          const key = group.phase?.id ?? 'no-phase';
          const collapsed = collapsedGroups.has(key);
          return (
            <tbody key={key}>
              <tr className="border-b border-border bg-surface-2">
                <td colSpan={5} className="p-2">
                  <button
                    onClick={() => toggleGroup(key)}
                    aria-expanded={!collapsed}
                    className="font-semibold text-fg hover:text-accent"
                  >
                    {collapsed ? '▸' : '▾'} {group.phase?.name ?? 'No phase'}
                    <span className="ml-2 text-fg-muted">({group.tickets.length})</span>
                  </button>
                </td>
              </tr>
              {!collapsed &&
                group.tickets.flatMap((t) => [
                  <TicketRow key={t.id} item={t} depth={0} onOpen={setOpenTicketId} />,
                  ...t.subtasks.map((s) => (
                    <TicketRow key={s.id} item={s} depth={1} onOpen={setOpenTicketId} />
                  )),
                ])}
            </tbody>
          );
        })}
      </table>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          className="rounded-omarchy border border-border bg-surface px-2 py-1 text-fg hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <span>
          Page {page} of {totalPages} · {data?.total ?? 0} items
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
          className="rounded-omarchy border border-border bg-surface px-2 py-1 text-fg hover:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
      {openTicketId && project && (
        <TicketDetailModal
          ticketId={openTicketId}
          project={project}
          onClose={() => setOpenTicketId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
