import { roundForPrompt } from "./digest";
import type { AiGrade, Digest } from "./types";

/**
 * The AI synthesis half of the grade (#8, bucket 2). Builds one Anthropic Messages
 * request that narrates plan adherence / execution / outcome and coaches, and parses
 * the structured reply. The API key stays server-side: the built body is handed to
 * the Rust `grade_via_anthropic` command, which injects the key (mirrors how
 * ingestion isolates the Databento key). This module is pure — no Tauri — so it unit
 * tests without a network.
 */

/** Default coaching model (Sonnet, per SPEC §5). Opus is reserved for the deeper
 *  end-of-module coaching pass, wired later. Model IDs from the `claude-api` skill. */
export const GRADE_MODEL = "claude-sonnet-5";
export const DEEP_COACH_MODEL = "claude-opus-4-8";

/** Structured-output schema for the three-axis grade. Constrained so the reply parses
 *  deterministically (no numeric bounds — structured outputs don't enforce min/max, so
 *  the range lives in the field description and the prompt). */
const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    planAdherence: axisSchema("How faithfully the trade tape followed the committed prep — the called bias and the marked levels."),
    execution: axisSchema("Quality of entries, exits, stops and trade management, judged on process not profit."),
    outcome: axisSchema("The realized result in R and dollars, contextualized — the least-weighted axis."),
    summary: { type: "string", description: "Two to three sentences of direct, process-first coaching." },
  },
  required: ["planAdherence", "execution", "outcome", "summary"],
} as const;

function axisSchema(description: string) {
  return {
    type: "object",
    additionalProperties: false,
    description,
    properties: {
      score: { type: "integer", description: "0–100." },
      notes: { type: "string", description: "One or two sentences on this axis." },
    },
    required: ["score", "notes"],
  };
}

const SYSTEM_PROMPT = [
  "You are a futures trading coach for an ORB/IB practice simulator. You grade a single practice",
  "attempt on PROCESS, not outcome: a disciplined loss can outscore a lucky win.",
  "",
  "You are given a compact JSON digest of one attempt: the trader's frozen pre-market plan (bias",
  "call, prose bias, marked levels/zones), an optional journal note, the realized 2-hour market",
  "structure, a distilled trade tape, and an OBJECTIVE report card that has ALREADY been computed",
  "(level-marking coverage/precision and the bias call vs the realized window).",
  "",
  "Do NOT recompute or second-guess the objective report-card numbers — treat them as ground truth",
  "and reference them. Your job is judgment the numbers can't make: grade three axes 0–100 and coach.",
  "- planAdherence: did the trades honor the committed bias and lean on the marked levels?",
  "- execution: entry/exit/stop quality and trade management as a process, independent of P&L.",
  "- outcome: the realized R/$ result, contextualized; weight this least.",
  "Each trade may carry a user setup tag (its intended archetype) and objective confirmation flags",
  "stamped at entry — a 5m close beyond the level, a volume increase, an in-direction engulfing",
  "candle, and agreement with the HTF trend. Weigh execution higher when entries were taken WITH",
  "confirmation and the tag matched what the tape shows; flag entries taken against a flat/opposing",
  "read or with no confirmation. These flags are given, not for you to recompute.",
  "Be specific and reference concrete numbers from the digest. Keep the summary to 2–3 sentences.",
].join("\n");

/** Build the full Messages API request body (the Rust command adds the key + version). */
export function buildGradeRequest(digest: Digest): Record<string, unknown> {
  const rounded = roundForPrompt(digest);
  return {
    model: GRADE_MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          "Grade this attempt. Digest:\n```json\n" +
          JSON.stringify(rounded, null, 2) +
          "\n```",
      },
    ],
    output_config: { format: { type: "json_schema", schema: GRADE_SCHEMA } },
  };
}

/** Extract the first text block from an Anthropic Messages response. */
function firstText(response: unknown): string {
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new Error("no content blocks in Anthropic response");
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      return String((block as { text?: unknown }).text ?? "");
    }
  }
  throw new Error("no text block in Anthropic response");
}

function toAxis(v: unknown, name: string): AiGrade["planAdherence"] {
  const o = (v ?? {}) as { score?: unknown; notes?: unknown };
  const score = Number(o.score);
  if (!Number.isFinite(score)) throw new Error(`missing ${name}.score`);
  return { score: Math.max(0, Math.min(100, Math.round(score))), notes: String(o.notes ?? "") };
}

/** Parse + validate the structured three-axis grade out of the Anthropic response. */
export function parseAiGrade(response: unknown): AiGrade {
  const parsed = JSON.parse(firstText(response)) as Record<string, unknown>;
  return {
    planAdherence: toAxis(parsed.planAdherence, "planAdherence"),
    execution: toAxis(parsed.execution, "execution"),
    outcome: toAxis(parsed.outcome, "outcome"),
    summary: String(parsed.summary ?? ""),
  };
}
