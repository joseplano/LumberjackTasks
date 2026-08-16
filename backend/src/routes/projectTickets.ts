import { Router, type Request } from 'express';
import { createTicket, listTickets } from '../services/tickets';

type ProjectParams = { projectId: string };

const router = Router({ mergeParams: true });

router.get('/', async (req: Request<ProjectParams>, res) => {
  res.json(
    await listTickets(
      req.params.projectId,
      req.query.parent as string | undefined,
      req.query.placement as string | undefined,
    ),
  );
});

router.post('/', async (req: Request<ProjectParams>, res) => {
  res.status(201).json(await createTicket(req.user!.sub, req.params.projectId, req.body ?? {}));
});

export default router;
