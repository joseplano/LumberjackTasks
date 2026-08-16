import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiFetch } from '../apiClient';
import { run } from './helpers';

const ticketFields = {
  description: z.string().optional(),
  labelId: z.string().nullable().optional().describe('Label id, or null to clear'),
  tokensConsumed: z.number().optional().describe('Total tokens consumed (>= 0)'),
  llmName: z
    .string()
    .nullable()
    .optional()
    .describe('LLM name; required by the backend when tokens are consumed'),
  developmentTimeMinutes: z.number().optional().describe('Total development time in minutes'),
  phaseId: z
    .string()
    .nullable()
    .optional()
    .describe('Phase id for a top-level ticket, or null to clear. Rejected on subtickets.'),
};

const complexity = z
  .number()
  .refine((v) => [1, 2, 3, 5, 8, 13, 21].includes(v), {
    message: 'complexity must be one of the Fibonacci values 1, 2, 3, 5, 8, 13 or 21',
  })
  .describe('Fibonacci complexity accepted by the backend: 1, 2, 3, 5, 8, 13 or 21');

const moveFields = {
  targetColumnId: z.string(),
  tokensDelta: z.number().optional().describe('Tokens consumed during this transition'),
  timeDelta: z.number().optional().describe('Minutes spent during this transition'),
  llmName: z.string().optional().describe('LLM used; required if tokensDelta > 0 and the ticket has none'),
};

export function registerTicketTools(server: McpServer) {
  server.registerTool(
    'list_tickets',
    {
      title: 'List tickets',
      description:
        "List a project's tickets. Use parent='none' for top-level tickets only, or a ticket id to list that ticket's subtickets.",
      inputSchema: {
        projectId: z.string(),
        parent: z.string().optional().describe("'none' or a parent ticket id"),
      },
    },
    async ({ projectId, parent }) =>
      run(() =>
        apiFetch(`/projects/${encodeURIComponent(projectId)}/tickets`, { query: { parent } }),
      ),
  );

  server.registerTool(
    'create_ticket',
    {
      title: 'Create ticket',
      description:
        'Create a ticket in a project. It lands in the given column or the first column by default.',
      inputSchema: {
        projectId: z.string(),
        name: z.string(),
        complexity,
        columnId: z.string().optional(),
        ...ticketFields,
      },
    },
    async ({ projectId, ...body }) =>
      run(() =>
        apiFetch(`/projects/${encodeURIComponent(projectId)}/tickets`, {
          method: 'POST',
          body,
        }),
      ),
  );

  server.registerTool(
    'update_ticket',
    {
      title: 'Update ticket',
      description:
        'Update ticket fields (name, description, complexity, label, tokens, LLM, time). Use move_ticket to change column.',
      inputSchema: {
        ticketId: z.string(),
        name: z.string().optional(),
        complexity: complexity.optional(),
        ...ticketFields,
      },
    },
    async ({ ticketId, ...body }) =>
      run(() => apiFetch(`/tickets/${encodeURIComponent(ticketId)}`, { method: 'PATCH', body })),
  );

  server.registerTool(
    'move_ticket',
    {
      title: 'Move ticket',
      description:
        "Move a ticket to another column, optionally registering token/time consumption for the transition. Parent tickets can only move forward when every subticket is in the target column or later. Moving the last ticket on the board into the project's completion column causes the backend to sweep every ticket off the board. When that happens the response contains a non-null `sweep` summary and the returned ticket's columnId is null -- the ticket is completed, not lost, and remains in the backlog. To restore a completed ticket, call this same tool with a targetColumnId to place it back on the board.",
      inputSchema: { ticketId: z.string(), ...moveFields },
    },
    async ({ ticketId, ...body }) =>
      run(() =>
        apiFetch(`/tickets/${encodeURIComponent(ticketId)}/move`, { method: 'POST', body }),
      ),
  );

  server.registerTool(
    'create_subticket',
    {
      title: 'Create subticket',
      description: 'Create a subticket under a parent ticket.',
      inputSchema: {
        projectId: z.string(),
        parentTicketId: z.string(),
        name: z.string(),
        complexity,
        columnId: z.string().optional(),
        ...ticketFields,
      },
    },
    async ({ projectId, ...body }) =>
      run(() =>
        apiFetch(`/projects/${encodeURIComponent(projectId)}/tickets`, {
          method: 'POST',
          body,
        }),
      ),
  );

  server.registerTool(
    'update_subticket',
    {
      title: 'Update subticket',
      description:
        'Update subticket fields (name, description, complexity, label, tokens, LLM, time).',
      inputSchema: {
        subticketId: z.string(),
        name: z.string().optional(),
        complexity: complexity.optional(),
        ...ticketFields,
      },
    },
    async ({ subticketId, ...body }) =>
      run(() =>
        apiFetch(`/tickets/${encodeURIComponent(subticketId)}`, { method: 'PATCH', body }),
      ),
  );

  server.registerTool(
    'move_subticket',
    {
      title: 'Move subticket',
      description:
        "Move a subticket to another column, optionally registering token/time consumption. Subtickets move freely. Moving the last ticket on the board into the project's completion column causes the backend to sweep every ticket off the board. When that happens the response contains a non-null `sweep` summary and the returned subticket's columnId is null -- the ticket is completed, not lost, and remains in the backlog. To restore a completed subticket, call this same tool with a targetColumnId to place it back on the board.",
      inputSchema: { subticketId: z.string(), ...moveFields },
    },
    async ({ subticketId, ...body }) =>
      run(() =>
        apiFetch(`/tickets/${encodeURIComponent(subticketId)}/move`, { method: 'POST', body }),
      ),
  );
}
