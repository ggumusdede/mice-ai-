import type { AiService } from './index.js';
import { ClaudeAiService, DEFAULT_FAST_MODEL, DEFAULT_MODEL, type AnthropicLike } from './claude.js';
import { MockAiService } from './mock.js';

/**
 * Returns ClaudeAiService when ANTHROPIC_API_KEY is set (and AI_PROVIDER!=='mock'), else MockAiService.
 * Env: ANTHROPIC_API_KEY, AI_PROVIDER ('mock' | 'claude'), AI_MODEL (default claude-sonnet-5-5),
 * AI_MODEL_FAST (default claude-haiku-5-5), AI_MAX_RETRIES (default 3), AI_TIMEOUT_MS (default 120000),
 * AI_FALLBACKS ('off' disables server-side refusal fallback), AI_ALLOW_BINARY_DOCS ('false' blocks PDFs/images, KVKK).
 */
export function createAiService(env: Record<string, string | undefined> = process.env, deps: { client?: AnthropicLike } = {}): AiService {
  const provider = (env.AI_PROVIDER ?? '').trim().toLowerCase();
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (provider === 'mock' || !key) return new MockAiService();
  const int = (v: string | undefined) => (v && /^\d+$/.test(v.trim()) ? Number(v.trim()) : undefined);
  return new ClaudeAiService({
    apiKey: key,
    client: deps.client,
    model: env.AI_MODEL?.trim() || DEFAULT_MODEL,
    fastModel: env.AI_MODEL_FAST?.trim() || DEFAULT_FAST_MODEL,
    maxRetries: int(env.AI_MAX_RETRIES),
    timeoutMs: int(env.AI_TIMEOUT_MS),
    fallbacks: (env.AI_FALLBACKS ?? '').trim().toLowerCase() !== 'off',
    allowBinaryDocuments: (env.AI_ALLOW_BINARY_DOCS ?? '').trim().toLowerCase() !== 'false',
  });
}
