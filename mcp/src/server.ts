import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerProjectTools } from './tools/projects';
import { registerTicketTools } from './tools/tickets';
import { registerManagementTools } from './tools/management';
import { registerReportTools } from './tools/reports';

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'lumberjack-tasks-mcp', version: '1.0.0' });
  registerProjectTools(server);
  registerTicketTools(server);
  registerManagementTools(server);
  registerReportTools(server);
  return server;
}
