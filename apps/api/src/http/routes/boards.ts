import { idParamSchema, pageQuerySchema } from '@flowsync/shared';
import { Router } from 'express';
import { currentUser } from '../../auth/middleware.js';
import { requireBoardAccess } from '../../services/access.js';
import { listActivity } from '../../services/activity.js';
import { deleteBoard, getBoard, listMessages } from '../../services/boards.js';
import { parse } from '../../validate.js';
import type { AppContext } from '../context.js';

export function boardsRouter({ prisma, realtime }: AppContext): Router {
  const router = Router();

  router.get('/:id', async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    res.json(await getBoard(prisma, currentUser(req).id, id));
  });

  router.delete('/:id', async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    await deleteBoard(prisma, currentUser(req).id, id);
    realtime.boardDeleted(id);
    res.status(204).end();
  });

  router.get('/:id/messages', async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const query = parse(pageQuerySchema, req.query);
    await requireBoardAccess(prisma, currentUser(req).id, id);
    res.json(await listMessages(prisma, id, query));
  });

  router.get('/:id/activity', async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const query = parse(pageQuerySchema, req.query);
    await requireBoardAccess(prisma, currentUser(req).id, id);
    res.json(await listActivity(prisma, id, query));
  });

  return router;
}
