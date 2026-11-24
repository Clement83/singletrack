import { and, eq, gte, isNull, or } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, user, type OutingRow } from '@/db/schema';
import { getInvitationByToken, isClosed } from '@/lib/outings/service';
import { isDone } from '@/lib/outings/history';
import { listParticipants } from '@/lib/outings/participants';
import { profileFor } from '@/lib/outings/profile';
import type { Actor } from '@/lib/outings/comments';

/** JSON API of the companion app (#1720): same rights as `/s/<slug>` (organiser) and `/i/<token>` (guest), read only. */
export type AppContext = { outing: OutingRow; actor: Actor; role: 'organizer' | 'guest'; invitationId?: string; userId?: string };

const RECENT_MS = 30 * 86_400_000;

const isManager = (o: OutingRow, userId: string) => o.ownerId === userId || (o.ownerId == null && o.createdBy === userId);

/**
 * Outing of an app account by slug (organiser, like `/s/<slug>`) or by id (also for a guest linked to the account through
 * their invitation). Anything else, including an outing the account may not see, is `undefined` (404).
 */
export function appOutingContext(db: Db, userId: string, ref: string): AppContext | undefined {
  const o = db.select().from(outing).where(or(eq(outing.slug, ref), eq(outing.id, ref))).get();
  if (!o) return undefined;
  if (isManager(o, userId)) return { outing: o, actor: { kind: 'organizer', userId }, role: 'organizer', userId };
  const inv = db.select().from(invitation).where(and(eq(invitation.outingId, o.id), eq(invitation.userId, userId), isNull(invitation.revokedAt))).get();
  return inv ? { outing: o, actor: { kind: 'guest', invitationId: inv.id }, role: 'guest', invitationId: inv.id, userId } : undefined;
}

/** Same rights as `/i/<token>`: the personal link designates one invitation. No account needed. */
export function appGuestContext(db: Db, token: string): AppContext | undefined {
  const found = getInvitationByToken(db, token);
  return found ? { outing: found.outing, actor: { kind: 'guest', invitationId: found.invitation.id }, role: 'guest', invitationId: found.invitation.id } : undefined;
}

function summary(o: OutingRow, role: AppContext['role'], organizerName: string | null, now: Date) {
  return {
    id: o.id,
    ...(role === 'organizer' ? { slug: o.slug } : {}),
    role,
    title: o.title,
    startsAt: o.startsAt.toISOString(),
    status: o.status,
    cancelled: o.status === 'cancelled',
    done: isDone(o, now),
    closed: isClosed(o, now),
    meeting: { lat: o.meetingLat, lon: o.meetingLon, label: o.meetingLabel },
    distanceM: o.trackSnapshot.distanceM,
    elevationGainM: o.trackSnapshot.elevationGainM ?? null,
    level: o.level,
    ebike: o.ebike,
    organizerName,
  };
}

const nameOf = (db: Db, id: string | null) => (id ? db.select({ name: user.name }).from(user).where(eq(user.id, id)).get()?.name ?? null : null);

/** "My outings": managed by the account or linked invitation, upcoming and recent (30 days), oldest first. */
export function listAppOutings(db: Db, userId: string, now = new Date()) {
  const since = new Date(now.getTime() - RECENT_MS);
  const managed = db.select().from(outing)
    .where(and(gte(outing.startsAt, since), or(eq(outing.ownerId, userId), and(isNull(outing.ownerId), eq(outing.createdBy, userId))))).all();
  const linked = db.select({ o: outing }).from(invitation).innerJoin(outing, eq(outing.id, invitation.outingId))
    .where(and(eq(invitation.userId, userId), isNull(invitation.revokedAt), gte(outing.startsAt, since))).all().map((r) => r.o);
  const seen = new Set<string>();
  const out: ReturnType<typeof summary>[] = [];
  for (const o of [...managed, ...linked].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(summary(o, isManager(o, userId) ? 'organizer' : 'guest', nameOf(db, o.ownerId ?? o.createdBy), now));
  }
  return out;
}

/** Outing detail (same fields as `OutingView` + frozen route with profile and bbox). Never the track slug or an invitation token. */
export function appOutingDetail(db: Db, ctx: AppContext, now = new Date()) {
  const o = ctx.outing;
  const t = o.trackSnapshot;
  const participants = listParticipants(db, o.id, { invitationId: ctx.invitationId, userId: ctx.userId });
  const mine = ctx.invitationId ? db.select({ status: invitation.status, comment: invitation.comment }).from(invitation).where(eq(invitation.id, ctx.invitationId)).get() : undefined;
  return {
    ...summary(o, ctx.role, nameOf(db, o.ownerId ?? o.createdBy), now),
    description: o.description,
    maxParticipants: o.maxParticipants,
    visibility: o.visibility,
    webPath: ctx.role === 'organizer' ? `/s/${o.slug}` : null,
    myAnswer: mine?.status ?? null,
    yesCount: participants.filter((p) => p.status === 'yes').length,
    participants,
    track: {
      name: t.name, geometry: t.geometry, bbox: t.bbox, start: t.start, distanceM: t.distanceM,
      elevationGainM: t.elevationGainM, elevationLossM: t.elevationLossM, minEle: t.minEle, maxEle: t.maxEle,
      difficulty: t.difficulty, loop: t.loop, attribution: t.attribution, license: t.license,
      profile: profileFor(t.geometry),
    },
  };
}
