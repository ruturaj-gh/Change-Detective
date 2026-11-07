/**
 * POST /api/ai/insights
 * Server-side route that calls the local Ollama instance.
 * The Gemini/Ollama API key never reaches the browser.
 *
 * Payload shape (from the dashboard client):
 *  { scan, findings, topChanges }
 *
 * Returns:
 *  { headline, bullets, disclaimer }
 */
import { NextRequest, NextResponse } from "next/server";

const OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env["OLLAMA_MODEL"] ?? "llama3.2";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const prompt = buildPrompt(body);

  // Call Ollama
  let ollamaRes: Response;
  try {
    ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `Ollama is not reachable at ${OLLAMA_URL}. Start it with: ollama serve`,
        detail: msg,
      },
      { status: 503 }
    );
  }

  if (!ollamaRes.ok) {
    return NextResponse.json(
      { error: `Ollama returned ${ollamaRes.status}. Is the model "${OLLAMA_MODEL}" downloaded?` },
      { status: 502 }
    );
  }

  const raw = (await ollamaRes.json()) as { response?: string };
  const text = raw.response ?? "";

  // Parse the structured response from the model
  const result = parseModelOutput(text);
  return NextResponse.json(result);
}

function buildPrompt(body: Record<string, unknown>): string {
  const scan = body["scan"] as Record<string, unknown> | undefined;
  const findings = body["findings"] as Array<Record<string, string>> | undefined;
  const topChanges = body["topChanges"] as Array<Record<string, unknown>> | undefined;

  const changesText = (topChanges ?? [])
    .map((c) => {
      const bytes = Number(c["deltaBytes"]);
      const gb = (Math.abs(bytes) / 1e9).toFixed(1);
      const sign = bytes >= 0 ? "+" : "-";
      const pct = c["percentChange"] != null ? ` (${c["percentChange"]}%)` : "";
      return `- ${c["path"]}: ${sign}${gb} GB${pct} [${c["label"]}]`;
    })
    .join("\n");

  const findingsText = (findings ?? [])
    .map((f) => `- [${f["severity"]}] ${f["title"]}: ${f["description"]}`)
    .join("\n");

  return `You are a local storage analysis assistant. Analyze the following scan results and provide a BRIEF, factual summary. 
DO NOT claim to identify malware or causes. Only report what the data shows.
DO NOT make up information. Only use what is provided.

SCAN STATUS: ${scan?.["status"] ?? "unknown"}
DIRECTORIES SCANNED: ${scan?.["scannedDirectoryCount"] ?? "?"}
DIRECTORIES INACCESSIBLE: ${scan?.["inaccessibleDirectoryCount"] ?? "?"}

TOP DIRECTORY CHANGES:
${changesText || "No changes detected."}

FINDINGS:
${findingsText || "No findings."}

Respond ONLY in this exact JSON format (no markdown, no extra text):
{
  "headline": "One sentence summary of the most notable storage change",
  "bullets": [
    "Factual observation 1",
    "Factual observation 2",
    "Factual observation 3"
  ],
  "disclaimer": "AI analysis is based on filesystem size changes only. Change Detective cannot determine the cause of changes."
}`;
}

function parseModelOutput(text: string): {
  headline: string;
  bullets: string[];
  disclaimer: string;
} {
  // Try to extract JSON from the model response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        headline?: string;
        bullets?: string[];
        disclaimer?: string;
      };
      return {
        headline: parsed.headline ?? "Scan analysis complete.",
        bullets: Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, 5) : [],
        disclaimer:
          parsed.disclaimer ??
          "AI analysis is based on filesystem size changes only.",
      };
    } catch {
      // Fall through to plain text parse
    }
  }

  // Fallback: treat the whole response as the headline
  return {
    headline: text.trim().slice(0, 200) || "Analysis complete.",
    bullets: [],
    disclaimer: "AI analysis is based on filesystem size changes only. Change Detective cannot determine the cause of changes.",
  };
}

