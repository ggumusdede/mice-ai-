// §6 closed authority list guard. The API layer calls this before letting any AI-originated action run.
import { AI_ACTIONS, aiAuthorityOf, type AiActionType, type AiAuthority } from '@mice/shared';
import type { DraftRequest } from './index.js';

export class AiAuthorityError extends Error {
  readonly code = 'ai_forbidden_action';
  constructor(
    readonly action: string,
    readonly authority: AiAuthority,
    readonly mode: 'autonomous' | 'draft',
    message: string,
  ) {
    super(message);
    this.name = 'AiAuthorityError';
  }
}

/**
 * Throws unless the AI may perform `action` in `mode`:
 *  - 'forbidden' (and anything not in the closed list) → always throws.
 *  - mode 'draft'      → the AI only PRODUCES a draft/suggestion that a human approves: allowed for 'autonomous'
 *                        and 'suggest' actions.
 *  - mode 'autonomous' → executes without human approval: allowed only for 'autonomous' actions, or for 'suggest'
 *                        actions that were promoted per §16 (pass `{ promoted: true }`).
 * Returns the action's authority level on success.
 */
export function assertAiMayPerform(action: string, mode: 'autonomous' | 'draft', opts: { promoted?: boolean } = {}): AiAuthority {
  const authority = aiAuthorityOf(action);
  const known = Object.prototype.hasOwnProperty.call(AI_ACTIONS, action);
  if (authority === 'forbidden') {
    throw new AiAuthorityError(action, authority, mode,
      known
        ? `Yapay zekâ bu işlemi yapamaz (§6 yasak): ${(AI_ACTIONS as Record<string, { label: string }>)[action].label}`
        : `Yapay zekâ bu işlemi yapamaz: '${action}' kapalı listede yok (§6).`);
  }
  if (mode === 'autonomous' && authority === 'suggest' && !opts.promoted) {
    throw new AiAuthorityError(action, authority, mode,
      `İnsan onayı gerekli (§6 öneri): ${(AI_ACTIONS as Record<string, { label: string }>)[action].label}`);
  }
  return authority;
}

/** Non-throwing variant. */
export function aiMayPerform(action: string, mode: 'autonomous' | 'draft', opts: { promoted?: boolean } = {}): boolean {
  try {
    assertAiMayPerform(action, mode, opts);
    return true;
  } catch {
    return false;
  }
}

/** The §6 action that a draft of the given kind represents (what a human must approve before it is sent). */
export function draftActionFor(kind: DraftRequest['kind']): AiActionType {
  switch (kind) {
    case 'missing_info': return 'customer_missing_info_question';
    case 'rfq': return 'rfq_send';
    case 'rfq_reminder': return 'supplier_rfq_reminder';
    case 'negotiation': return 'negotiation_message';
    case 'quote_cover':
    case 'quote_followup': return 'customer_quote';
    case 'option_extension': return 'option_extension_request';
    case 'revision_request': return 'revision_request';
    // Drafting a supplier confirmation is allowed (Adım 5); SENDING it ('supplier_confirmation') is forbidden.
    case 'supplier_confirmation':
    case 'daily_summary':
    case 'other':
    default: return 'draft_generation';
  }
}
