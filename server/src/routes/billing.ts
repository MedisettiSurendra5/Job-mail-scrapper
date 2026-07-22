import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { getDailyUsage, getEffectivePlan } from "../billing";
import { PLANS, PlanId } from "../types";

export const billingRouter = Router();
billingRouter.use(requireAuth);

billingRouter.get("/me", async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  const effectivePlan = getEffectivePlan(user);
  const daysRemaining =
    effectivePlan !== "free" && user.planExpiresAt
      ? Math.max(0, Math.ceil((user.planExpiresAt.getTime() - Date.now()) / 86_400_000))
      : null;
  const dailyUsage = effectivePlan === "free" ? await getDailyUsage(user.id) : null;

  res.json({
    plan: user.plan,
    effectivePlan,
    planExpiresAt: user.planExpiresAt,
    daysRemaining,
    dailyUsage,
  });
});

const redeemSchema = z.object({ code: z.string().min(1) });

billingRouter.post("/redeem", async (req, res) => {
  const parsed = redeemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a promo code" });

  const code = await prisma.promoCode.findUnique({ where: { code: parsed.data.code.trim().toUpperCase() } });
  if (!code) return res.status(404).json({ error: "That promo code doesn't exist" });
  if (code.expiresAt && code.expiresAt < new Date()) {
    return res.status(400).json({ error: "That promo code has expired" });
  }
  if (code.maxRedemptions !== null && code.redeemedCount >= code.maxRedemptions) {
    return res.status(400).json({ error: "That promo code has already been fully redeemed" });
  }
  const already = await prisma.promoRedemption.findUnique({
    where: { userId_promoCodeId: { userId: req.user!.id, promoCodeId: code.id } },
  });
  if (already) return res.status(409).json({ error: "You've already redeemed this promo code" });

  const planExpiresAt = new Date(Date.now() + code.durationDays * 86_400_000);
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user!.id }, data: { plan: code.planTarget, planExpiresAt } }),
    prisma.promoCode.update({ where: { id: code.id }, data: { redeemedCount: { increment: 1 } } }),
    prisma.promoRedemption.create({ data: { userId: req.user!.id, promoCodeId: code.id } }),
  ]);

  res.json({ plan: code.planTarget as PlanId, planExpiresAt, planName: PLANS[code.planTarget as PlanId]?.name });
});
