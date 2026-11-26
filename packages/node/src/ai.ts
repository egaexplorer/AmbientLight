import fs from "node:fs";
import path from "node:path";
import { errorMessage } from "./errors.js";

/** A free tier that takes the chat-completions format. */
export interface AiProvider {
  name: string;
  /** The environment variable that holds its API key. */
  key: string;
  url: string;
  model: string;
}

/** The first one whose key is set is used. */
export const AI_PROVIDERS: readonly AiProvider[] = [
  {
    name: "Gemini",
    key: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-3.5-flash-lite",
  },
  {
    name: "Groq",
    key: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "openai/gpt-oss-20b",
  },
];

export interface AiRequest {
  system: string;
  user: string;
  /** Name and JSON schema of the answer (OpenAI `json_schema` response format, strict). */
  schemaName: string;
  schema: Record<string, unknown>;
  /** Cancels the request, e.g. on Ctrl+C. */
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface AiClient {
  /** e.g. "Gemini (gemini-3.5-flash-lite)". */
  name: string;
  /** Sends one request and returns the answer's text. The caller checks it: a schema is a request, not a promise. */
  chatJson(request: AiRequest): Promise<string>;
}

/** A client for the first provider whose key is set in `env`, or `undefined` without a key. Needs no SDK. */
export function createAiClient(env: NodeJS.ProcessEnv, fetchFn: typeof fetch = fetch): AiClient | undefined {
  const provider = AI_PROVIDERS.find(({ key }) => env[key]?.trim());
  if (!provider) return undefined;
  const apiKey = env[provider.key]!.trim();
  const hideKey = (text: string): string => text.replaceAll(apiKey, "***");

  return {
    name: `${provider.name} (${provider.model})`,
    async chatJson({ system, user, schemaName, schema, signal, timeoutMs }) {
      const timeout = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetchFn(provider.url, {
          method: "POST",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: provider.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
          }),
        });
      } catch (error) {
        if (timeout.aborted) throw new Error(`${provider.name} didn't answer within ${timeoutMs / 1000} s`);
        throw new Error(`Can't reach ${provider.name} (${hideKey(errorMessage(error))})`);
      }
      if (!response.ok) {
        const detail = hideKey(await response.text()).replace(/\s+/g, " ").slice(0, 200);
        throw new Error(`${provider.name} HTTP ${response.status}: ${detail}`);
      }
      const body: any = await response.json().catch(() => undefined);
      return String(body?.choices?.[0]?.message?.content ?? "");
    },
  };
}

/**
 * Loads `.env` from `dir` into `process.env`, if there is one. Variables that are already set win. Returns the file
 * that was loaded.
 */
export function loadEnvFileIn(dir: string): string | undefined {
  const file = path.join(dir, ".env");
  if (!fs.existsSync(file)) return undefined;
  process.loadEnvFile(file);
  return file;
}
