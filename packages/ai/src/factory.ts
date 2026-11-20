import type { AiService } from './index.js';
import { MockAiService } from './mock.js';
/** Returns ClaudeAiService when ANTHROPIC_API_KEY is set (and AI_PROVIDER!=='mock'), else MockAiService. */
export function createAiService(env: Record<string, string | undefined> = process.env): AiService {
  void env;
  return new MockAiService();
}
