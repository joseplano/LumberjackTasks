import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiFetch } from '../apiClient';
import { fail, run } from './helpers';

export function registerManagementTools(server: McpServer) {
  server.registerTool(
    'manage_columns',
    {
      title: 'Manage kanban columns',
      description:
        "Manage a project's kanban columns. Actions: list, create (name), rename (columnId, name), reorder (orderedIds), delete (columnId; moveTo required by the backend when the column still has tickets).",
      inputSchema: {
        projectId: z.string(),
        action: z.enum(['list', 'create', 'rename', 'reorder', 'delete']),
        columnId: z.string().optional().describe('Required for rename and delete'),
        name: z.string().optional().describe('Required for create and rename'),
        orderedIds: z.array(z.string()).optional().describe('Required for reorder: all column ids in the new order'),
        moveTo: z.string().optional().describe('Destination column id when deleting a column that has tickets'),
      },
    },
    async ({ projectId, action, columnId, name, orderedIds, moveTo }) => {
      const base = `/projects/${encodeURIComponent(projectId)}/columns`;
      switch (action) {
        case 'list':
          return run(() => apiFetch(base));
        case 'create':
          if (!name) return fail('name is required for action "create"');
          return run(() => apiFetch(base, { method: 'POST', body: { name } }));
        case 'rename':
          if (!columnId) return fail('columnId is required for action "rename"');
          if (!name) return fail('name is required for action "rename"');
          return run(() =>
            apiFetch(`${base}/${encodeURIComponent(columnId)}`, {
              method: 'PATCH',
              body: { name },
            }),
          );
        case 'reorder':
          if (!orderedIds) return fail('orderedIds is required for action "reorder"');
          return run(() => apiFetch(`${base}/order`, { method: 'PUT', body: { orderedIds } }));
        case 'delete':
          if (!columnId) return fail('columnId is required for action "delete"');
          return run(() =>
            apiFetch(`${base}/${encodeURIComponent(columnId)}`, {
              method: 'DELETE',
              query: { moveTo },
            }),
          );
      }
    },
  );

  server.registerTool(
    'manage_labels',
    {
      title: 'Manage labels',
      description:
        "Manage a project's labels. Actions: list, create (name, color), update (labelId, name and/or color), delete (labelId; force=true required by the backend when the label is in use).",
      inputSchema: {
        projectId: z.string(),
        action: z.enum(['list', 'create', 'update', 'delete']),
        labelId: z.string().optional().describe('Required for update and delete'),
        name: z.string().optional(),
        color: z.string().optional().describe('Hex color, e.g. #ff0000'),
        force: z.boolean().optional().describe('Confirm deleting a label that is in use'),
      },
    },
    async ({ projectId, action, labelId, name, color, force }) => {
      const base = `/projects/${encodeURIComponent(projectId)}/labels`;
      switch (action) {
        case 'list':
          return run(() => apiFetch(base));
        case 'create':
          return run(() => apiFetch(base, { method: 'POST', body: { name, color } }));
        case 'update':
          if (!labelId) return fail('labelId is required for action "update"');
          return run(() =>
            apiFetch(`${base}/${encodeURIComponent(labelId)}`, {
              method: 'PATCH',
              body: { name, color },
            }),
          );
        case 'delete':
          if (!labelId) return fail('labelId is required for action "delete"');
          return run(() =>
            apiFetch(`${base}/${encodeURIComponent(labelId)}`, {
              method: 'DELETE',
              query: { force: force ? 'true' : undefined },
            }),
          );
      }
    },
  );

  server.registerTool(
    'manage_phases',
    {
      title: 'Manage phases',
      description:
        "Manage a project's phases (epics). A phase groups top-level tickets; subtasks inherit their parent's phase. Actions: list, create (name, description), update (phaseId, name and/or description), reorder (orderedIds = every phase id in the desired order), delete (phaseId; force=true required by the backend when the phase still has tickets — forcing unassigns them, it never deletes them).",
      inputSchema: {
        projectId: z.string(),
        action: z.enum(['list', 'create', 'update', 'reorder', 'delete']),
        phaseId: z.string().optional().describe('Required for update and delete'),
        name: z.string().optional(),
        description: z.string().optional(),
        orderedIds: z.array(z.string()).optional().describe('Required for reorder'),
        force: z.boolean().optional().describe('Confirm deleting a phase that still has tickets'),
      },
    },
    async ({ projectId, action, phaseId, name, description, orderedIds, force }) => {
      const base = `/projects/${encodeURIComponent(projectId)}/phases`;
      switch (action) {
        case 'list':
          return run(() => apiFetch(base));
        case 'create':
          if (!name) return fail('name is required for action "create"');
          return run(() => apiFetch(base, { method: 'POST', body: { name, description } }));
        case 'update':
          if (!phaseId) return fail('phaseId is required for action "update"');
          return run(() =>
            apiFetch(`${base}/${encodeURIComponent(phaseId)}`, {
              method: 'PATCH',
              body: { name, description },
            }),
          );
        case 'reorder':
          if (!orderedIds) return fail('orderedIds is required for action "reorder"');
          return run(() => apiFetch(`${base}/order`, { method: 'PUT', body: { orderedIds } }));
        case 'delete':
          if (!phaseId) return fail('phaseId is required for action "delete"');
          return run(() =>
            apiFetch(`${base}/${encodeURIComponent(phaseId)}`, {
              method: 'DELETE',
              query: { force: force ? 'true' : undefined },
            }),
          );
      }
    },
  );
}
