import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiFetch } from '../apiClient';
import { run } from './helpers';

interface Metrics {
  totalTokens: number;
  totalTimeMinutes: number;
  ticketCount: number;
}

export function registerReportTools(server: McpServer) {
  server.registerTool(
    'get_reports',
    {
      title: 'Get reports',
      description:
        'Global reports: most-active (rankings by hours and tokens), consumption (per-project extremes), transitions (status-change stats).',
      inputSchema: { report: z.enum(['most-active', 'consumption', 'transitions']) },
    },
    async ({ report }) => run(() => apiFetch(`/reports/${report}`)),
  );

  server.registerTool(
    'get_token_usage',
    {
      title: 'Get token usage',
      description: 'Total tokens consumed across all tickets of a project.',
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) =>
      run(async () => {
        const m = await apiFetch<Metrics>(`/projects/${encodeURIComponent(projectId)}/metrics`);
        return { totalTokens: m.totalTokens, ticketCount: m.ticketCount };
      }),
  );

  server.registerTool(
    'get_time_totals',
    {
      title: 'Get time totals',
      description: 'Total development time (minutes) across all tickets of a project.',
      inputSchema: { projectId: z.string() },
    },
    async ({ projectId }) =>
      run(async () => {
        const m = await apiFetch<Metrics>(`/projects/${encodeURIComponent(projectId)}/metrics`);
        return { totalTimeMinutes: m.totalTimeMinutes, ticketCount: m.ticketCount };
      }),
  );
}
