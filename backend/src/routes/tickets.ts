import { Router } from 'express';
import { getTicketDetail, updateTicket, deleteTicket } from '../services/tickets';
import { moveTicket } from '../services/moves';

const router = Router();

router.get('/:id', async (req, res) => {
  res.json(await getTicketDetail(req.params.id));
});

router.patch('/:id', async (req, res) => {
  res.json(await updateTicket(req.user!.sub, req.params.id, req.body ?? {}));
});

router.post('/:id/move', async (req, res) => {
  res.json(await moveTicket(req.user!.sub, req.params.id, req.body ?? {}));
});

router.delete('/:id', async (req, res) => {
  await deleteTicket(req.user!.sub, req.params.id);
  res.json({ deleted: true });
});

export default router;
