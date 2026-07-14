'use client';

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { ProjectDetail, Ticket } from '@/lib/types';
import TicketCard from './TicketCard';

function DraggableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={
        transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined
      }
      className={isDragging ? 'cursor-grabbing opacity-50' : 'cursor-grab'}
    >
      {children}
    </div>
  );
}

function DroppableColumn({
  id,
  name,
  children,
}: {
  id: string;
  name: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-testid="kanban-column"
      data-column-id={id}
      className={`w-64 shrink-0 rounded-omarchy border p-2 ${isOver ? 'border-accent bg-accent/10' : 'border-border bg-surface-2'}`}
    >
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{name}</h3>
      {children}
    </div>
  );
}

export default function Board({
  project,
  tickets,
  onTicketClick,
  onMove,
}: {
  project: ProjectDetail;
  tickets: Ticket[];
  onTicketClick: (ticketId: string) => void;
  onMove?: (ticketId: string, targetColumnId: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const columns = [...project.columns].sort((a, b) => a.position - b.position);
  const labelById = new Map(project.labels.map((l) => [l.id, l]));
  const subCounts = new Map<string, number>();
  for (const t of tickets) {
    if (t.parentTicketId) {
      subCounts.set(t.parentTicketId, (subCounts.get(t.parentTicketId) ?? 0) + 1);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const ticketId = String(event.active.id);
    const target = event.over ? String(event.over.id) : null;
    const current = tickets.find((t) => t.id === ticketId);
    if (target && current && current.columnId !== target) {
      onMove?.(ticketId, target);
    }
  }

  const board = (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {columns.map((col) => (
        <DroppableColumn key={col.id} id={col.id} name={col.name}>
          <div className="space-y-2">
            {tickets
              .filter((t) => t.columnId === col.id)
              .map((t) => {
                const card = (
                  <TicketCard
                    ticket={t}
                    label={t.labelId ? labelById.get(t.labelId) : null}
                    subticketCount={subCounts.get(t.id) ?? 0}
                    onClick={() => onTicketClick(t.id)}
                  />
                );
                return onMove ? (
                  <DraggableCard key={t.id} id={t.id}>
                    {card}
                  </DraggableCard>
                ) : (
                  <div key={t.id}>{card}</div>
                );
              })}
          </div>
        </DroppableColumn>
      ))}
    </div>
  );

  return onMove ? (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {board}
    </DndContext>
  ) : (
    board
  );
}
