import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import chatRouter from './routes/chat.route';
import syncRouter from './routes/sync.route';
import logger from './utils/logger';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/chat', chatRouter);
app.use('/api/sync', syncRouter);

export default app;
