import { Router, type Request } from 'express';
import { listLabels, createLabel, updateLabel, deleteLabel } from '../services/labels';

type ProjectParams = { projectId: string };
type LabelParams = { projectId: string; labelId: string };

const router = Router({ mergeParams: true });

router.get('/', async (req: Request<ProjectParams>, res) => {
  res.json(await listLabels(req.params.projectId));
});

router.post('/', async (req: Request<ProjectParams>, res) => {
  res.status(201).json(await createLabel(req.user!.sub, req.params.projectId, req.body ?? {}));
});

router.patch('/:labelId', async (req: Request<LabelParams>, res) => {
  res.json(
    await updateLabel(req.user!.sub, req.params.projectId, req.params.labelId, req.body ?? {}),
  );
});

router.delete('/:labelId', async (req: Request<LabelParams>, res) => {
  await deleteLabel(
    req.user!.sub,
    req.params.projectId,
    req.params.labelId,
    req.query.force === 'true',
  );
  res.json({ deleted: true });
});

export default router;
