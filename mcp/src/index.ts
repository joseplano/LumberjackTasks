import { createApp } from './app';
import { config } from './config';

createApp().listen(config.port, config.host, () => {
  console.log(`MCP server listening on ${config.host}:${config.port}`);
});
