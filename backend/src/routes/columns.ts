import { Router, type Request } from 'express';
import {
  listColumns,
  createColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
} from '../services/columns';
import { asOptionalString, asOptionalBoolean } from '../utils/params';

type ProjectParams = { projectId: string };
type ColumnParams = { projectId: string; columnId: string };

const router = Router({ mergeParams: true });

router.get('/', async (req: Request<ProjectParams>, res) => {
  res.json(await listColumns(req.params.projectId));
});

router.post('/', async (req: Request<ProjectParams>, res) => {
  res.status(201).json(await createColumn(req.user!.sub, req.params.projectId, req.body?.name));
});

router.put('/order', async (req: Request<ProjectParams>, res) => {
  res.json(await reorderColumns(req.user!.sub, req.params.projectId, req.body?.orderedIds));
});

router.patch('/:columnId', async (req: Request<ColumnParams>, res) => {
  res.json(
    await updateColumn(req.user!.sub, req.params.projectId, req.params.columnId, {
      name: asOptionalString(req.body?.name, 'name'),
      isCompletionColumn: asOptionalBoolean(req.body?.isCompletionColumn, 'isCompletionColumn'),
    }),
  );
});

router.delete('/:columnId', async (req: Request<ColumnParams>, res) => {
  await deleteColumn(
    req.user!.sub,
    req.params.projectId,
    req.params.columnId,
    asOptionalString(req.query.moveTo, 'moveTo'),
  );
  res.json({ deleted: true });
});

export default router;
