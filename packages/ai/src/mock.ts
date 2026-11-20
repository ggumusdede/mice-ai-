import type { AiService } from './index.js';
// TODO(ai agent): implement deterministic heuristic extraction (regex-based TR/EN/RU) for tests & dev.
export class MockAiService implements Partial<AiService> { readonly name = 'mock'; }
