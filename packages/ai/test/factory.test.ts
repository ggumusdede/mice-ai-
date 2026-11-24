import { describe, expect, it } from 'vitest';
import { ClaudeAiService, MockAiService, createAiService } from '../src/index.js';

describe('createAiService', () => {
  it('mock without key', () => {
    expect(createAiService({})).toBeInstanceOf(MockAiService);
    expect(createAiService({ ANTHROPIC_API_KEY: '  ' }).name).toBe('mock');
  });
  it('mock when AI_PROVIDER=mock even with a key', () => {
    expect(createAiService({ ANTHROPIC_API_KEY: 'sk-test', AI_PROVIDER: 'mock' })).toBeInstanceOf(MockAiService);
  });
  it('claude with key, default and overridden models', () => {
    const a = createAiService({ ANTHROPIC_API_KEY: 'sk-test' }) as ClaudeAiService;
    expect(a).toBeInstanceOf(ClaudeAiService);
    expect(a.model).toBe('claude-sonnet-5-5');
    expect(a.fastModel).toBe('claude-haiku-5-5');
    const b = createAiService({ ANTHROPIC_API_KEY: 'sk-test', AI_PROVIDER: 'claude', AI_MODEL: 'claude-opus-5-5', AI_MODEL_FAST: 'claude-sonnet-5-5' }) as ClaudeAiService;
    expect(b.model).toBe('claude-opus-5-5');
    expect(b.fastModel).toBe('claude-sonnet-5-5');
  });
});
