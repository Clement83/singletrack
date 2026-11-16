import { byToken, friendsHandlers } from '@/lib/outings/friends-http';

export const dynamic = 'force-dynamic';
const h = friendsHandlers(byToken);

/** Sous /api/i (public pour le lien) mais compte exigé. Droits : `outingPermissions(...).canInviteFriends` du compte. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) { return h.GET(req, (await params).token); }
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) { return h.POST(req, (await params).token); }
