import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { isPublicPath, isPublicRead } from '@/lib/public-routes';
import { isFederationPath } from '@/lib/federation/paths';
import { federationEnabled } from '@/lib/federation/config';

// Filtre optimiste (présence du cookie) : la vraie vérification de session est refaite côté serveur
// dans chaque layout/page privé (requireUser) et chaque action d'écriture (assertUser).
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Fédération (#1474) : AVANT la redirection vers /login. `FEDERATION=off` : 404, rien n'atteint Fedify.
  if (isFederationPath(pathname)) {
    if (!federationEnabled()) return new NextResponse(null, { status: 404 });
    return await handleFederation(req);
  }
  if (isPublicPath(pathname) || isPublicRead(pathname, req.method) || getSessionCookie(req)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', req.url));
}

// Fedify (@fedify/next) répond WebFinger, NodeInfo, acteur et boîtes d'entrée ; le reste passe (page 404 de Next).
async function handleFederation(req: NextRequest) {
  const [{ fedifyWith }, { getFederation }, guard] = await Promise.all([import('@fedify/next'), import('@/lib/federation'), import('@/lib/federation/inbox-guard')]);
  const next = fedifyWith(getFederation())();
  if (!guard.isInboxRequest(req, req.nextUrl.pathname)) return (await next(req)) as Response;
  // Boîtes d'entrée (#1477) : taille, serveur bloqué, débit, avant la vérification des signatures.
  const g = await guard.guardInbox(req);
  if ('response' in g) return g.response;
  const res = (await next(new NextRequest(g.request))) as Response;
  guard.logFedifyRefusal(g.domain, res.status);
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
