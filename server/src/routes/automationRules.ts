import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAdmin, requireAuth } from "../middleware/auth";
import { startRule, stopRule, runRuleNow } from "../scheduler";
import { FILTER_OPTIONS } from "../types";

export const automationRulesRouter = Router();
automationRulesRouter.use(requireAuth, requireAdmin);

const ruleSchema = z.object({
  name: z.string().min(1),
  searchTerm: z.string().min(1),
  applyFilters: z.boolean().default(true),
  country: z.array(z.string()).default([]),
  company: z.string().default(""),
  seniority: z.array(z.string()).default([...FILTER_OPTIONS.seniority.slice(1, 3)]),
  jobTypes: z.array(z.string()).default([FILTER_OPTIONS.jobTypes[0]]),
  workModel: z.array(z.string()).default([]),
  daysAgo: z.string().default("Past 24 hours"),
  maxPerRun: z.number().int().min(1).max(50).default(10),
  autoSend: z.boolean().default(false),
  sendAsUserId: z.number().int().nullable().optional(),
  intervalHours: z.number().int().min(1).max(168).default(2),
  enabled: z.boolean().default(true),
});

function toRow(input: z.infer<typeof ruleSchema>) {
  return {
    name: input.name,
    searchTerm: input.searchTerm,
    applyFilters: input.applyFilters,
    country: input.country.join(","),
    company: input.company,
    seniority: input.seniority.join(","),
    jobTypes: input.jobTypes.join(","),
    workModel: input.workModel.join(","),
    daysAgo: input.daysAgo,
    maxPerRun: input.maxPerRun,
    autoSend: input.autoSend,
    sendAsUserId: input.sendAsUserId ?? null,
    intervalHours: input.intervalHours,
    enabled: input.enabled,
  };
}

function toJson(rule: Awaited<ReturnType<typeof prisma.automationRule.findFirstOrThrow>>) {
  const split = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);
  return {
    id: rule.id,
    name: rule.name,
    searchTerm: rule.searchTerm,
    applyFilters: rule.applyFilters,
    country: split(rule.country),
    company: rule.company,
    seniority: split(rule.seniority),
    jobTypes: split(rule.jobTypes),
    workModel: split(rule.workModel),
    daysAgo: rule.daysAgo,
    maxPerRun: rule.maxPerRun,
    autoSend: rule.autoSend,
    sendAsUserId: rule.sendAsUserId,
    intervalHours: rule.intervalHours,
    enabled: rule.enabled,
    lastRunAt: rule.lastRunAt,
    createdById: rule.createdById,
  };
}

automationRulesRouter.get("/", async (_req, res) => {
  const rules = await prisma.automationRule.findMany({
    orderBy: { id: "desc" },
    include: { sendAsUser: { select: { email: true } }, createdBy: { select: { email: true } } },
  });
  type RuleWithEmails = Parameters<typeof toJson>[0] & {
    sendAsUser: { email: string } | null;
    createdBy: { email: string };
  };
  res.json({ rules: rules.map((r: RuleWithEmails) => ({ ...toJson(r), sendAsEmail: r.sendAsUser?.email, createdByEmail: r.createdBy.email })) });
});

automationRulesRouter.post("/", async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const rule = await prisma.automationRule.create({
    data: { ...toRow(parsed.data), createdById: req.user!.id },
  });
  if (rule.enabled) startRule(rule.id, rule.intervalHours);
  res.status(201).json({ rule: toJson(rule) });
});

automationRulesRouter.put("/:id", async (req, res) => {
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const id = Number(req.params.id);
  const existing = await prisma.automationRule.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Rule not found" });

  const merged = ruleSchema.parse({ ...toJson(existing), ...parsed.data });
  const rule = await prisma.automationRule.update({ where: { id }, data: toRow(merged) });

  if (rule.enabled) startRule(rule.id, rule.intervalHours);
  else stopRule(rule.id);
  res.json({ rule: toJson(rule) });
});

automationRulesRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  stopRule(id);
  await prisma.automationRule.delete({ where: { id } }).catch(() => {});
  res.json({ ok: true });
});

automationRulesRouter.post("/:id/run-now", async (req, res) => {
  const id = Number(req.params.id);
  const rule = await prisma.automationRule.findUnique({ where: { id } });
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  const task = await runRuleNow(id);
  res.json({ taskId: task.id });
});
