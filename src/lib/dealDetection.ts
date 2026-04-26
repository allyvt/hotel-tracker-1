export type DealTier = "GREAT_DEAL" | "DEAL" | "FAIR" | "OVERPRICED";

export interface DealAnalysis {
  tier: DealTier;
  savingsPercent: number;
  avgPrice30Day: number | null;
  currentPrice: number;
  label: string;
}

// Thresholds per spec: 20%+ below avg = DEAL, 35%+ = GREAT DEAL
const DEAL_THRESHOLD = 0.2;
const GREAT_DEAL_THRESHOLD = 0.35;

export function analyzeDeal(
  currentPrice: number,
  priceHistory: number[]
): DealAnalysis {
  if (priceHistory.length < 3) {
    // Not enough history to make a call
    return {
      tier: "FAIR",
      savingsPercent: 0,
      avgPrice30Day: null,
      currentPrice,
      label: "Insufficient history",
    };
  }

  const avg =
    priceHistory.reduce((sum, p) => sum + p, 0) / priceHistory.length;
  const savingsPercent = (avg - currentPrice) / avg;

  let tier: DealTier;
  let label: string;

  if (savingsPercent >= GREAT_DEAL_THRESHOLD) {
    tier = "GREAT_DEAL";
    label = `${Math.round(savingsPercent * 100)}% below avg — Great Deal!`;
  } else if (savingsPercent >= DEAL_THRESHOLD) {
    tier = "DEAL";
    label = `${Math.round(savingsPercent * 100)}% below avg — Deal`;
  } else if (savingsPercent < 0) {
    tier = "OVERPRICED";
    label = `${Math.round(Math.abs(savingsPercent) * 100)}% above avg`;
  } else {
    tier = "FAIR";
    label = "Fair price";
  }

  return {
    tier,
    savingsPercent,
    avgPrice30Day: Math.round(avg * 100) / 100,
    currentPrice,
    label,
  };
}
