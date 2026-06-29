import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { collaboratorInviteTable, collaboratorTable } from "@/db/schema";

export const dynamic = "force-dynamic";

type InviteState =
  | { status: "unavailable" }
  | { status: "wrong_account" }
  | { status: "ready"; destinationPath: string }
  | {
      status: "otp_required";
      email: string;
      maskedEmail: string;
      destinationPath: string;
    };

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const getInvite = async (token: string) => {
  const invite = await db.query.collaboratorInviteTable.findFirst({
    where: eq(collaboratorInviteTable.token, token),
  });

  if (!invite) return null;

  if (invite.expiresAt <= new Date()) {
    await db
      .delete(collaboratorInviteTable)
      .where(eq(collaboratorInviteTable.id, invite.id));
    return null;
  }

  const collaborator = await db.query.collaboratorTable.findFirst({
    where: and(
      eq(sql`lower(${collaboratorTable.email})`, invite.email.toLowerCase()),
      eq(sql`lower(${collaboratorTable.owner})`, invite.owner.toLowerCase()),
      eq(sql`lower(${collaboratorTable.repo})`, invite.repo.toLowerCase()),
    ),
  });

  if (!collaborator) {
    await db
      .delete(collaboratorInviteTable)
      .where(eq(collaboratorInviteTable.id, invite.id));
    return null;
  }

  return invite;
};

const getDestinationPath = (invite: typeof collaboratorInviteTable.$inferSelect) => {
  return `/${invite.owner}/${invite.repo}`;
};

const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;

  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(1, name.length - visible.length))}@${domain}`;
};

const claimInvite = async (
  invite: typeof collaboratorInviteTable.$inferSelect,
  user: { id: string; email: string },
) => {
  if (normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
    return false;
  }

  await db
    .update(collaboratorTable)
    .set({ userId: user.id })
    .where(
      and(
        eq(sql`lower(${collaboratorTable.email})`, invite.email.toLowerCase()),
        eq(sql`lower(${collaboratorTable.owner})`, invite.owner.toLowerCase()),
        eq(sql`lower(${collaboratorTable.repo})`, invite.repo.toLowerCase()),
      ),
    );

  await db
    .delete(collaboratorInviteTable)
    .where(eq(collaboratorInviteTable.id, invite.id));

  return true;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const invite = await getInvite(token);
  if (!invite) {
    return Response.json({ status: "unavailable" } satisfies InviteState);
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  });
  const destinationPath = getDestinationPath(invite);

  if (!session?.user) {
    return Response.json({
      status: "otp_required",
      email: invite.email,
      maskedEmail: maskEmail(invite.email),
      destinationPath,
    } satisfies InviteState);
  }

  const claimed = await claimInvite(invite, session.user);
  if (!claimed) {
    return Response.json({ status: "wrong_account" } satisfies InviteState);
  }

  return Response.json({
    status: "ready",
    destinationPath,
  } satisfies InviteState);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const invite = await getInvite(token);
  if (!invite) {
    return Response.json({ status: "unavailable" } satisfies InviteState, {
      status: 404,
    });
  }

  const session = await auth.api.getSession({
    headers: request.headers,
  });
  if (!session?.user) {
    return Response.json({ status: "unavailable" } satisfies InviteState, {
      status: 401,
    });
  }

  const claimed = await claimInvite(invite, session.user);
  if (!claimed) {
    return Response.json({ status: "wrong_account" } satisfies InviteState, {
      status: 403,
    });
  }

  return Response.json({
    status: "ready",
    destinationPath: getDestinationPath(invite),
  } satisfies InviteState);
}
