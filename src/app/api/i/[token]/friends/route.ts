import { byToken, friendsHandlers } from '@/lib/outings/friends-http';

export const dynamic = 'force-dynamic';
const h = friendsHandlers(byToken);

/** Under /api/i (public for the link) but an account is required. Rights: the account's `outingPermissions(...).canInviteFriends`. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) { return h.GET(req, (await params).token); }
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) { return h.POST(req, (await params).token); }
