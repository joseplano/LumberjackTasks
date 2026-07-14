import { createApp } from './app';
import { config } from './config';

createApp().listen(config.port, () => {
  console.log(`Backend listening on :${config.port}`);
});
