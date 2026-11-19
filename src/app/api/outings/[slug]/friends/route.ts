import { bySlug, friendsHandlers } from '@/lib/outings/friends-http';

export const dynamic = 'force-dynamic';
const h = friendsHandlers(bySlug);

/** Private. GET: invitable friends; POST `{ userIds }`: invites (link tied to the account + email). */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) { return h.GET(req, (await params).slug); }
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) { return h.POST(req, (await params).slug); }
