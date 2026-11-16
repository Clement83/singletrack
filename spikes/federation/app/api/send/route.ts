import { Follow } from '@fedify/vocab';
import { federation, db } from '../../../federation';
// POST {from:'alice', to:'http://app2:3000/ap/users/paul'} : envoie un Follow signé.
export async function POST(req: Request) {
  const { from, to } = await req.json();
  const ctx = federation.createContext(req, undefined);
  const target = await ctx.lookupObject(to);
  if (!target) return Response.json({ error: 'introuvable' }, { status: 404 });
  await ctx.sendActivity({ identifier: from }, target as any,
    new Follow({ id: new URL(`${ctx.canonicalOrigin}/ap/follows/${Date.now()}`), actor: ctx.getActorUri(from), object: (target as any).id }));
  return Response.json({ ok: true });
}
export async function GET() { return Response.json(db.prepare('select m from spike_log').all()); }
