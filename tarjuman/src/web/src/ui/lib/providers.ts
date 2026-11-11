import type { ProviderKind, ProviderState, ProviderStatus } from '../../../../shared/protocol';

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  stt: 'Speech recognition',
  mt: 'Translation',
  tts: 'Voice',
};

export const PROVIDER_STATE_LABEL: Record<ProviderState, string> = {
  ready: 'Ready',
  cooldown: 'Cooling down',
  unconfigured: 'Needs a key',
  disabled: 'Disabled',
};

export type ChainTone = 'ok' | 'warn' | 'danger' | 'unknown';

export interface ChainSummary {
  tone: ChainTone;
  /** The provider that handles requests right now (first ready one in fallback order). */
  active: ProviderStatus | null;
  /** Earliest end of a cooldown when nothing is ready, epoch ms. */
  cooldownUntil: number | null;
}

export function inFallbackOrder(chain: readonly ProviderStatus[]): ProviderStatus[] {
  return [...chain].sort((a, b) => a.order - b.order);
}

/** Collapse a fallback chain into the one status the header shows. */
export function summarizeChain(chain: readonly ProviderStatus[]): ChainSummary {
  if (chain.length === 0) return { tone: 'unknown', active: null, cooldownUntil: null };
  const ordered = inFallbackOrder(chain);
  const ready = ordered.find((provider) => provider.state === 'ready');
  if (ready) return { tone: 'ok', active: ready, cooldownUntil: null };
  const cooling = ordered.filter((provider) => provider.state === 'cooldown');
  if (cooling.length > 0) {
    const ends = cooling.flatMap((provider) => (provider.cooldownUntil === undefined ? [] : [provider.cooldownUntil]));
    return { tone: 'warn', active: null, cooldownUntil: ends.length > 0 ? Math.min(...ends) : null };
  }
  return { tone: 'danger', active: null, cooldownUntil: null };
}

/** True when the chain can do its job now or will be able to after a cooldown. */
export function chainUsable(chain: readonly ProviderStatus[]): boolean {
  return chain.some((provider) => provider.state === 'ready' || provider.state === 'cooldown');
}
