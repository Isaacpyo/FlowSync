import {
  createBoardSchema,
  createWorkspaceSchema,
  idParamSchema,
  inviteMemberSchema,
} from '@flowsync/shared';
import { Router } from 'express';
import { currentUser } from '../../auth/middleware.js';
import {
  createBoard,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceDetail,
  inviteMember,
  listWorkspaces,
} from '../../services/workspaces.js';
import { parse } from '../../validate.js';
import type { AppContext } from '../context.js';

export function workspacesRouter({ prisma, realtime }: AppContext): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await listWorkspaces(prisma, currentUser(req).id));
  });

  router.post('/', async (req, res) => {
    const { name } = parse(createWorkspaceSchema, req.body);
    res.status(201).json(await createWorkspace(prisma, currentUser(req).id, name));
  });

  router.get('/:id', async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    res.json(await getWorkspaceDetail(prisma, currentUser(req).id, id));
  });

  router.delete('/:id', async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const { boardIds } = await deleteWorkspace(prisma, currentUser(req).id, id);
    for (const boardId of boardIds) realtime.boardDeleted(boardId);
    res.status(204).end();
  });

  router.post('/:id/members', async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const { email } = parse(inviteMemberSchema, req.body);
    res.status(201).json(await inviteMember(prisma, currentUser(req).id, id, email));
  });

  router.post('/:id/boards', async (req, res) => {
    const { id } = parse(idParamSchema, req.params);
    const input = parse(createBoardSchema, req.body);
    res.status(201).json(await createBoard(prisma, currentUser(req).id, id, input));
  });

  return router;
}
