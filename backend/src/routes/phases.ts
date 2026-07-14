import { Router, type Request } from 'express';
import {
  listPhases,
  createPhase,
  updatePhase,
  reorderPhases,
  deletePhase,
} from '../services/phases';

type ProjectParams = { projectId: string };
type PhaseParams = { projectId: string; phaseId: string };

const router = Router({ mergeParams: true });

router.get('/', async (req: Request<ProjectParams>, res) => {
  res.json(await listPhases(req.params.projectId));
});

router.post('/', async (req: Request<ProjectParams>, res) => {
  res.status(201).json(await createPhase(req.user!.sub, req.params.projectId, req.body ?? {}));
});

router.put('/order', async (req: Request<ProjectParams>, res) => {
  res.json(await reorderPhases(req.user!.sub, req.params.projectId, req.body?.orderedIds));
});

router.patch('/:phaseId', async (req: Request<PhaseParams>, res) => {
  res.json(
    await updatePhase(req.user!.sub, req.params.projectId, req.params.phaseId, req.body ?? {}),
  );
});

router.delete('/:phaseId', async (req: Request<PhaseParams>, res) => {
  await deletePhase(
    req.user!.sub,
    req.params.projectId,
    req.params.phaseId,
    req.query.force === 'true',
  );
  res.json({ deleted: true });
});

export default router;
