import { prisma } from "./db";
import { jobrightQueue } from "./queue";
import { SearchFilters } from "./types";

// One in-process setInterval per enabled AutomationRule. Interval
// granularity here is hours, so a plain setInterval is enough - no need for
// real cron semantics or a persistence layer for exact phase across
// restarts (timers just restart from boot time).
const timers = new Map<number, ReturnType<typeof setInterval>>();

function toFilters(rule: {
  searchTerm: string;
  applyFilters: boolean;
  country: string;
  company: string;
  seniority: string;
  jobTypes: string;
  workModel: string;
  daysAgo: string;
}): SearchFilters {
  const split = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);
  return {
    searchTerm: rule.searchTerm,
    applyFilters: rule.applyFilters,
    country: split(rule.country),
    company: rule.company,
    seniority: split(rule.seniority),
    jobTypes: split(rule.jobTypes),
    workModel: split(rule.workModel),
    daysAgo: rule.daysAgo,
  };
}

export async function runRuleNow(ruleId: number) {
  const rule = await prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
  return jobrightQueue.enqueue(
    "run_search",
    {
      filters: toFilters(rule),
      maxPerRun: rule.maxPerRun,
      requestedBy: rule.createdById,
      autoSend: rule.autoSend,
      sendAsUserId: rule.sendAsUserId ?? undefined,
      ruleId: rule.id,
    },
    rule.createdById
  );
}

export function stopRule(ruleId: number) {
  const t = timers.get(ruleId);
  if (t) {
    clearInterval(t);
    timers.delete(ruleId);
  }
}

export function startRule(ruleId: number, intervalHours: number) {
  stopRule(ruleId);
  const ms = Math.max(1, intervalHours) * 60 * 60 * 1000;
  timers.set(
    ruleId,
    setInterval(() => {
      runRuleNow(ruleId).catch((e) => console.error(`AutomationRule ${ruleId} run failed:`, e));
    }, ms)
  );
}

export async function initScheduler() {
  const rules = await prisma.automationRule.findMany({ where: { enabled: true } });
  for (const rule of rules) {
    startRule(rule.id, rule.intervalHours);
  }
}
