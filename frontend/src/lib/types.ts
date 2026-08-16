export interface Project {
  id: string;
  code: string;
  name: string;
  description: string;
  gitRepoUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumn {
  id: string;
  projectId: string;
  name: string;
  position: number;
  isCompletionColumn: boolean;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
}

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  description: string;
  position: number;
}

export interface ProjectDetail extends Project {
  columns: KanbanColumn[];
  labels: Label[];
  phases: Phase[];
}

export interface Ticket {
  id: string;
  projectId: string;
  number: number;
  parentTicketId: string | null;
  name: string;
  description: string;
  columnId: string | null;
  complexity: number;
  labelId: string | null;
  phaseId: string | null;
  tokensConsumed: number;
  llmName: string | null;
  developmentTimeMinutes: number;
  createdAt: string;
  updatedAt: string;
  label?: Label | null;
  column?: KanbanColumn | null;
}

export interface StatusChange {
  id: string;
  ticketId: string;
  fromColumnName: string;
  toColumnName: string;
  changedAt: string;
  tokensDelta: number | null;
  timeDelta: number | null;
}

export interface TicketDetail extends Ticket {
  subtickets: Ticket[];
  history: StatusChange[];
  totals: { totalTokens: number; totalTimeMinutes: number };
}

export interface BacklogItem {
  id: string;
  number: number;
  name: string;
  description: string;
  complexity: number;
  parentTicketId: string | null;
  status: string;
  // Authoritative, machine-readable flag for a swept (off-board) ticket.
  // Branch on this, not on `status` -- `status` is display text and can
  // collide with a user-chosen column name of the same text.
  completed: boolean;
  label: string | null;
  subtasks: BacklogItem[];
}

export interface BacklogGroup {
  phase: Pick<Phase, 'id' | 'name' | 'position'> | null;
  tickets: BacklogItem[];
}

export interface BacklogPage {
  groups: BacklogGroup[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProjectMetrics {
  totalTokens: number;
  totalTimeMinutes: number;
  ticketCount: number;
}

export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21];
