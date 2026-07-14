import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BackendError } from '../apiClient';

export function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof BackendError) {
      return fail(`${err.code} (HTTP ${err.status}): ${err.message}`);
    }
    return fail(err instanceof Error ? err.message : String(err));
  }
}
