import { Router } from 'express';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../services/projects';
import { projectMetrics } from '../services/metrics';
import { getBacklog } from '../services/backlog';

const router = Router();

router.get('/', async (req, res) => {
  res.json(await listProjects(req.query.search as string | undefined));
});

router.post('/', async (req, res) => {
  res.status(201).json(await createProject(req.user!.sub, req.body ?? {}));
});

router.get('/:id', async (req, res) => {
  res.json(await getProject(req.params.id));
});

router.get('/:id/metrics', async (req, res) => {
  res.json(await projectMetrics(req.params.id));
});

router.get('/:id/backlog', async (req, res) => {
  res.json(
    await getBacklog(req.params.id, {
      sortBy: req.query.sortBy as string | undefined,
      order: req.query.order as string | undefined,
      page: req.query.page as string | undefined,
      pageSize: req.query.pageSize as string | undefined,
    }),
  );
});

router.patch('/:id', async (req, res) => {
  res.json(await updateProject(req.user!.sub, req.params.id, req.body ?? {}));
});

router.delete('/:id', async (req, res) => {
  await deleteProject(req.user!.sub, req.params.id);
  res.json({ deleted: true });
});

export default router;
