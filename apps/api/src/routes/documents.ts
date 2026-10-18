import { Hono } from 'hono';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { ApiError } from '../errors';
import { loadVisibleDocument } from '../services/documents';

export function documentRoutes() {
  return new Hono<Env>()
    .get('/documents/:documentId', requireAuth, async (c) => {
      const { view } = await loadVisibleDocument(c.get('deps').db, c.get('user').id, c.req.param('documentId'));
      return c.json({ document: view });
    })
    .get('/documents/:documentId/download', requireAuth, async (c) => {
      const { view, content } = await loadVisibleDocument(c.get('deps').db, c.get('user').id, c.req.param('documentId'), true);
      if (view.status !== 'ready' || !content) throw new ApiError(409, 'not_ready', 'The document is not ready yet');
      const name = `${view.kind === 'ticket_pdf' ? 'tickets' : 'report'}-${view.id}.pdf`;
      return c.body(new Uint8Array(content), 200, {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename=${name}`,
        'cache-control': 'private, no-store',
      });
    });
}
