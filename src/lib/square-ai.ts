// Optional LLM refinement for Square signal extraction.
// If SQUARE_LLM_KEY (+BASE/MODEL) is unset, the route skips this entirely and
// rule-based extraction is used alone. OpenAI-compatible chat completions API.

export interface AiSignal {
  asset: string | null;
  side: "LONG" | "SHORT" | null;
  entry: number | null;
  target: number | null;
  stop: number | null;
  leverage: number | null;
  market: "SPOT" | "FUTURES" | null;
}

export interface AiInput {
  id: string;
  text: string;
}

const SYSTEM = `You extract crypto trading calls from Binance Square posts.
Return a JSON object {"signals":[{"id":string,"asset":string|null,"side":"LONG"|"SHORT"|null,"entry":number|null,"target":number|null,"stop":number|null,"leverage":number|null,"market":"SPOT"|"FUTURES"|null}]}.
Rules: asset = uppercase base symbol without $ (e.g. BTC, SOL); null if no tradable asset. side = author's directional call; "long squeeze"/breakdown language means SHORT, "short squeeze"/breakout language means LONG; null if neutral/news. entry/target/stop = prices in USD as plain numbers (never percentages); null if absent. leverage = futures leverage number or null. market = FUTURES only with explicit leverage/futures/perp mention, else SPOT. No commentary, JSON only.`;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export async function refineWithLlm(inputs: AiInput[]): Promise<Map<string, AiSignal>> {
  const out = new Map<string, AiSignal>();
  const key = process.env.SQUARE_LLM_KEY;
  if (!key || inputs.length === 0) return out;
  const base = (process.env.SQUARE_LLM_BASE ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.SQUARE_LLM_MODEL ?? "gpt-4o-mini";
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify({ posts: inputs.map(p => ({ id: p.id, text: p.text.slice(0, 1200) })) }) },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return out;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return out;
    const parsed = JSON.parse(content) as { signals?: Record<string, unknown>[] };
    for (const s of parsed.signals ?? []) {
      const id = typeof s.id === "string" ? s.id : "";
      if (!id) continue;
      const asset = typeof s.asset === "string" && /^[A-Z0-9]{2,12}$/.test(s.asset.toUpperCase()) ? s.asset.toUpperCase() : null;
      const side = s.side === "LONG" || s.side === "SHORT" ? s.side : null;
      const market = s.market === "SPOT" || s.market === "FUTURES" ? s.market : null;
      out.set(id, { asset, side, entry: num(s.entry), target: num(s.target), stop: num(s.stop), leverage: num(s.leverage), market });
    }
  } catch {
    // Fall through to rule-based results.
  }
  return out;
}
