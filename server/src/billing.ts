import { prisma } from "./db";
import { PLANS, PlanId } from "./types";

const FREE_DAILY_LIMIT = PLANS.free.dailyActionLimit!;

// A paid/promo plan lapses on its own once planExpiresAt passes - no cron
// job needed, this is just computed wherever the plan actually matters.
export function getEffectivePlan(user: { plan: string; planExpiresAt: Date | null }): PlanId {
  if (user.plan !== "free" && user.planExpiresAt && user.planExpiresAt > new Date()) {
    return user.plan as PlanId;
  }
  return "free";
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function getDailyUsage(userId: number): Promise<{ used: number; limit: number | null }> {
  const since = startOfToday();
  const [jobsToday, sendsToday] = await Promise.all([
    prisma.job.count({ where: { addedById: userId, createdAt: { gte: since } } }),
    prisma.contact.count({ where: { sentById: userId, sentAt: { gte: since } } }),
  ]);
  return { used: jobsToday + sendsToday, limit: FREE_DAILY_LIMIT };
}

// Thrown as a plain object matching the { status, message } convention
// already used by contacts.ts's route handlers.
export async function assertWithinQuota(userId: number): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (getEffectivePlan(user) !== "free") return;

  const { used, limit } = await getDailyUsage(userId);
  if (limit !== null && used >= limit) {
    throw {
      status: 403,
      message: `Daily free-plan limit reached (${limit} actions/day). Ask your admin to upgrade your plan, or redeem a promo code.`,
    };
  }
}
