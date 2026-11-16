import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const { GET, POST } = {
  GET: (req: Request) => toNextJsHandler(getAuth()).GET(req),
  POST: (req: Request) => toNextJsHandler(getAuth()).POST(req),
};
