import { createApp } from './app/app.js';
import { logger } from '@pkg/logger';

const app = createApp();
const port = Number(process.env.PORT ?? 3333);

app.listen(port, () => {
  logger.info({ component: 'bff', event: 'started', port });
});
