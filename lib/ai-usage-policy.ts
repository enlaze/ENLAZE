export interface AiUsagePolicy {
  maxOutputTokens: number;
  dailyTokensPerUser: number;
  dailyTokensGlobal: number;
}

export interface AiUsageRow {
  tokens_in?: number | null;
  tokens_out?: number | null;
}

const DEFAULT_POLICY: AiUsagePolicy = {
  maxOutputTokens: 5000,
  dailyTokensPerUser: 60_000,
  dailyTokensGlobal: 600_000,
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getAiUsagePolicy(
  env: Record<string, string | undefined> = process.env,
): AiUsagePolicy {
  return {
    maxOutputTokens: Math.min(
      8192,
      positiveInteger(env.AI_BUDGET_MAX_OUTPUT_TOKENS, DEFAULT_POLICY.maxOutputTokens),
    ),
    dailyTokensPerUser: positiveInteger(
      env.AI_BUDGET_DAILY_TOKENS_PER_USER,
      DEFAULT_POLICY.dailyTokensPerUser,
    ),
    dailyTokensGlobal: positiveInteger(
      env.AI_BUDGET_DAILY_TOKENS_GLOBAL,
      DEFAULT_POLICY.dailyTokensGlobal,
    ),
  };
}

export function sumAiTokens(rows: AiUsageRow[] | null | undefined) {
  return (rows || []).reduce(
    (sum, row) => sum + (Number(row.tokens_in) || 0) + (Number(row.tokens_out) || 0),
    0,
  );
}

export function canUseExternalAi(input: {
  userTokens: number;
  globalTokens: number;
  policy: AiUsagePolicy;
}) {
  return input.userTokens < input.policy.dailyTokensPerUser
    && input.globalTokens < input.policy.dailyTokensGlobal;
}

export function startOfUtcDay(now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

/** Stable, provider-neutral copy safe to expose to customers. */
export const TECHNICAL_ENGINE_SUMMARY =
  "Presupuesto calculado con el motor técnico ENLAZE y contrastado con las fuentes de precios disponibles.";
