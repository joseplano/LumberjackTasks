import { Router } from 'express';
import { mostActiveReport, consumptionReport, transitionsReport } from '../services/reports';

const router = Router();

router.get('/most-active', async (_req, res) => {
  res.json(await mostActiveReport());
});

router.get('/consumption', async (_req, res) => {
  res.json(await consumptionReport());
});

router.get('/transitions', async (_req, res) => {
  res.json(await transitionsReport());
});

export default router;
