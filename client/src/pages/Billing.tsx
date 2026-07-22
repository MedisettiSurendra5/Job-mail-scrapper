import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../api";
import type { BillingInfo, PlanId } from "../api";
import { PLAN_CATALOG } from "../api";
import { useToast } from "../Toast";

const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: ["3 actions/day (adding jobs + sending resumes, combined)", "Search, pull contacts, manual review"],
  pro: ["Unlimited job adds and resume sends", "All search and automation features", "Priority contact scraping"],
  elite: ["Everything in Pro", "A dedicated person who applies to jobs for you", "White-glove onboarding"],
};

export function Billing() {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show } = useToast();

  async function load() {
    const data = await api.get<BillingInfo>("/billing/me");
    setInfo(data);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRedeem(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setRedeeming(true);
    try {
      const result = await api.post<{ planName: string }>("/billing/redeem", { code });
      setCode("");
      await load();
      show(`Upgraded to ${result.planName}!`, "success");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to redeem code");
    } finally {
      setRedeeming(false);
    }
  }

  if (!info) {
    return (
      <div className="skeleton-page">
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  const current = PLAN_CATALOG[info.effectivePlan];
  const usagePct = info.dailyUsage && info.dailyUsage.limit ? Math.min(100, (info.dailyUsage.used / info.dailyUsage.limit) * 100) : 0;

  return (
    <div>
      <h1>Billing</h1>

      <div className="card">
        <h2>Your plan: {current.name}</h2>
        {info.effectivePlan !== "free" && info.daysRemaining !== null && (
          <p className="muted">Expires in {info.daysRemaining} day{info.daysRemaining === 1 ? "" : "s"}.</p>
        )}
        {info.effectivePlan === "free" && info.dailyUsage && (
          <div>
            <p className="muted">
              {info.dailyUsage.used} of {info.dailyUsage.limit} free actions used today.
            </p>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${usagePct}%` }} />
            </div>
          </div>
        )}
      </div>

      <form className="card" onSubmit={handleRedeem}>
        <h2>Redeem a promo code</h2>
        <label>
          Code
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. WELCOME30"
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={redeeming}>
          {redeeming ? "Redeeming..." : "Redeem"}
        </button>
      </form>

      <div className="plan-cards">
        {(Object.keys(PLAN_CATALOG) as PlanId[]).map((planId) => {
          const plan = PLAN_CATALOG[planId];
          return (
            <div key={planId} className={`card plan-card ${planId === info.effectivePlan ? "plan-card-active" : ""}`}>
              <h3>{plan.name}</h3>
              <div className="plan-price">{plan.priceUsd === 0 ? "Free" : `$${plan.priceUsd}/mo`}</div>
              <ul className="plan-feature-list">
                {PLAN_FEATURES[planId].map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {planId !== "free" && planId !== info.effectivePlan && (
                <p className="muted small">Contact your admin to upgrade.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
