import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { isPublicPath, isPublicRead } from '@/lib/public-routes';
import { isFederationPath } from '@/lib/federation/paths';
import { federationEnabled } from '@/lib/federation/config';

// Optimistic filter (cookie presence): the real session check is redone on the server
// in every private layout/page (requireUser) and every write action (assertUser).
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Federation (#1474): BEFORE the redirect to /login. `FEDERATION=off`: 404, nothing reaches Fedify.
  if (isFederationPath(pathname)) {
    if (!federationEnabled()) return new NextResponse(null, { status: 404 });
    return await handleFederation(req);
  }
  if (isPublicPath(pathname) || isPublicRead(pathname, req.method) || getSessionCookie(req)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', req.url));
}

// Fedify (@fedify/next) answers WebFinger, NodeInfo, actor and inboxes; the rest passes through (Next 404 page).
async function handleFederation(req: NextRequest) {
  const [{ fedifyWith }, { getFederation }, guard] = await Promise.all([import('@fedify/next'), import('@/lib/federation'), import('@/lib/federation/inbox-guard')]);
  // `/nodeinfo/2.1` is read with `Accept: application/json` (Fedify's own `getNodeInfo`, Mastodon…), which `fedifyWith` only
  // routes for `/.well-known/nodeinfo`: hand it to Fedify directly, otherwise the document is a Next 404 (#1775).
  if (req.nextUrl.pathname.startsWith('/nodeinfo/')) return getFederation().fetch(req, { contextData: undefined });
  const next = fedifyWith(getFederation())();
  if (!guard.isInboxRequest(req, req.nextUrl.pathname)) return (await next(req)) as Response;
  // Inboxes (#1477): size, blocked server, rate, before signature verification.
  const g = await guard.guardInbox(req);
  if ('response' in g) return g.response;
  const res = (await next(new NextRequest(g.request))) as Response;
  guard.logFedifyRefusal(g.domain, res.status);
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
