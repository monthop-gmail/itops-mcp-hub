export interface OcrProviderInfo {
  id: string;
  label: string;
  ready: boolean;
  model?: string;
  api_base?: string;
}

export interface OcrRunInput {
  provider?: string;
  mimeType: string;
  data: string;
}

export interface OcrRunOutput {
  provider: string;
  model: string;
  text: string;
}

export type OcrRunFn = (input: OcrRunInput) => Promise<OcrRunOutput>;

export const TYPHOON_DEFAULT_BASE = "https://api.opentyphoon.ai/v1";
export const TYPHOON_DEFAULT_MODEL = "typhoon-ocr";

const TYPHOON_PROMPT =
  "Extract this document as structured Markdown. Preserve Thai and English text, tables, and reading order. Do not invent missing stamps or signatures.";

export function activeOcrProviderId(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.RAG_OCR_PROVIDER ?? "typhoon").trim().toLowerCase();
  if (!raw || raw === "none" || raw === "off" || raw === "false") {
    return "none";
  }
  return raw;
}

/** LiteLLM-style `openai/typhoon-ocr-v1.5` maps to the OpenTyphoon chat model id. */
export function resolveTyphoonModel(raw?: string): string {
  const name = (raw ?? TYPHOON_DEFAULT_MODEL).trim().replace(/^openai\//i, "");
  if (name === "typhoon-ocr-v1.5" || name === "typhoon-ocr-1.5") {
    return "typhoon-ocr";
  }
  if (name === "typhoon-ocr-v1" || name === "typhoon-ocr-1") {
    return "typhoon-ocr-preview";
  }
  return name || TYPHOON_DEFAULT_MODEL;
}

export function typhoonProviderInfo(env: NodeJS.ProcessEnv = process.env): OcrProviderInfo {
  const key = env.TYPHOON_API_KEY?.trim() ?? env.TYPHOON_OCR_API_KEY?.trim() ?? "";
  return {
    id: "typhoon",
    label: "Typhoon OCR (OpenTyphoon)",
    ready: key.length > 0,
    model: resolveTyphoonModel(env.TYPHOON_OCR_MODEL),
    api_base: (env.TYPHOON_API_BASE?.trim() || TYPHOON_DEFAULT_BASE).replace(/\/+$/, ""),
  };
}

export function listOcrProviders(env: NodeJS.ProcessEnv = process.env): OcrProviderInfo[] {
  return [typhoonProviderInfo(env)];
}

export function parseOcrModelText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (candidate.startsWith("{")) {
    try {
      const json = JSON.parse(candidate) as Record<string, unknown>;
      for (const key of ["natural_text", "markdown", "text"]) {
        const value = json[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    } catch {
      // keep the model text as-is
    }
  }
  return trimmed;
}

export async function runConfiguredOcr(
  input: OcrRunInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OcrRunOutput> {
  const provider = (input.provider || activeOcrProviderId(env)).toLowerCase();
  if (provider === "none") {
    throw new Error("RAG_OCR_PROVIDER=none — ยังไม่ส่งหน้าออกค่าย OCR");
  }
  if (provider === "typhoon") {
    return runTyphoonOcr(input, env);
  }
  throw new Error(`ยังไม่มีตัวทำงาน OCR ค่าย '${provider}' — รอคีย์ค่ายนั้นแล้วค่อยต่อ`);
}

export async function runTyphoonOcr(
  input: OcrRunInput,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<OcrRunOutput> {
  const info = typhoonProviderInfo(env);
  const apiKey = env.TYPHOON_API_KEY?.trim() || env.TYPHOON_OCR_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new Error("ยังไม่มี TYPHOON_API_KEY ใน .env ของไซต์");
  }
  if (!input.data) {
    throw new Error("ไม่มีภาพหน้าสำหรับ Typhoon OCR");
  }
  const mime = input.mimeType || "image/jpeg";
  const url = `${info.api_base}/chat/completions`;
  const model = info.model || TYPHOON_DEFAULT_MODEL;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: model === "typhoon-ocr-preview" ? 16384 : 8192,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: TYPHOON_PROMPT },
            { type: "image_url", image_url: { url: `data:${mime};base64,${input.data}` } },
          ],
        },
      ],
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Typhoon OCR HTTP ${response.status}: ${body.slice(0, 240)}`);
  }
  let parsed: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> };
  } catch {
    throw new Error("Typhoon OCR คืนค่าที่ไม่ใช่ JSON");
  }
  const content = parsed.choices?.[0]?.message?.content;
  const raw = typeof content === "string" ? content : "";
  const text = parseOcrModelText(raw);
  if (!text) {
    throw new Error("Typhoon OCR คืนข้อความว่าง");
  }
  return { provider: "typhoon", model, text };
}
