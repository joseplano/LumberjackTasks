import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiFetch } from '../apiClient';
import { run } from './helpers';

export function registerProjectTools(server: McpServer) {
  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List all projects, optionally filtered by name or code.',
      inputSchema: { search: z.string().optional().describe('Filter by project name or code') },
    },
    async ({ search }) => run(() => apiFetch('/projects', { query: { search } })),
  );

  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description:
        'Create a project. The project code is generated automatically and six default kanban columns are created.',
      inputSchema: {
        name: z.string().describe('Project name'),
        description: z.string().optional(),
        gitRepoUrl: z.string().optional(),
      },
    },
    async (input) => run(() => apiFetch('/projects', { method: 'POST', body: input })),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description: 'Get a project by id, including its kanban columns and labels.',
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) =>
      run(() => apiFetch(`/projects/${encodeURIComponent(projectId)}`)),
  );

  server.registerTool(
    'rename_project',
    {
      title: 'Rename project',
      description: 'Rename a project (optionally updating its description or git repo URL).',
      inputSchema: {
        projectId: z.string(),
        name: z.string().describe('New project name'),
        description: z.string().optional(),
        gitRepoUrl: z.string().optional(),
      },
    },
    async ({ projectId, ...body }) =>
      run(() =>
        apiFetch(`/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body }),
      ),
  );

  server.registerTool(
    'delete_project',
    {
      title: 'Delete project',
      description: 'Delete a project and all its tickets, columns and labels (cascade).',
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) =>
      run(() => apiFetch(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })),
  );
}
