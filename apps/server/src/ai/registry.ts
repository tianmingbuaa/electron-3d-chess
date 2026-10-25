import type {
  AiDifficulty,
  AiProvider,
  AiProviderInfo,
  AiProviderCapabilities,
} from '@nocturne/chess-shared';
import { createSimpleAiProvider } from './simple-provider.js';

export const AI_DIFFICULTIES: readonly AiDifficulty[] = Object.freeze([
  'easy',
  'normal',
  'hard',
] as const);

export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return typeof value === 'string' && (AI_DIFFICULTIES as readonly string[]).includes(value);
}

function validateProvider(provider: AiProvider): AiProviderInfo {
  if (typeof provider !== 'object' || provider === null) {
    throw new TypeError('AI provider must be an object.');
  }
  if (typeof provider.chooseMove !== 'function') {
    throw new TypeError('AI provider must implement chooseMove().');
  }
  const info = provider.info;
  if (typeof info !== 'object' || info === null) {
    throw new TypeError('AI provider info is missing.');
  }
  if (typeof info.id !== 'string' || info.id.trim() === '') {
    throw new TypeError('AI provider info.id must be a non-empty string.');
  }
  if (info.id.length > 64) {
    throw new TypeError('AI provider info.id must be at most 64 characters.');
  }
  if (typeof info.name !== 'string' || info.name.trim() === '') {
    throw new TypeError(`AI provider "${info.id}" must have a non-empty name.`);
  }
  if (typeof info.description !== 'string') {
    throw new TypeError(`AI provider "${info.id}" must have a description string.`);
  }
  if (typeof info.version !== 'string' || info.version.trim() === '') {
    throw new TypeError(`AI provider "${info.id}" must have a version string.`);
  }
  if (info.author !== undefined && typeof info.author !== 'string') {
    throw new TypeError(`AI provider "${info.id}" author must be a string.`);
  }

  const capabilities = info.capabilities;
  if (typeof capabilities !== 'object' || capabilities === null) {
    throw new TypeError(`AI provider "${info.id}" capabilities are missing.`);
  }
  if (
    !Array.isArray(capabilities.difficulties) ||
    capabilities.difficulties.length === 0 ||
    !capabilities.difficulties.every(isAiDifficulty)
  ) {
    throw new TypeError(
      `AI provider "${info.id}" must support at least one known difficulty.`,
    );
  }
  for (const flag of ['supportsTimeLimit', 'supportsCancellation', 'remote'] as const) {
    if (typeof capabilities[flag] !== 'boolean') {
      throw new TypeError(`AI provider "${info.id}" capability "${flag}" must be boolean.`);
    }
  }

  const normalizedCapabilities: AiProviderCapabilities = {
    difficulties: [...capabilities.difficulties],
    supportsTimeLimit: capabilities.supportsTimeLimit,
    supportsCancellation: capabilities.supportsCancellation,
    remote: capabilities.remote,
  };
  return {
    id: info.id,
    name: info.name,
    description: info.description,
    version: info.version,
    ...(info.author === undefined ? {} : { author: info.author }),
    capabilities: normalizedCapabilities,
  };
}

/**
 * In-memory registry for AI engines. The registry owns provider lifecycle
 * (`init` / `dispose`) but never game state: the session validates and applies
 * every move a provider returns.
 */
export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();
  private readonly infos = new Map<string, AiProviderInfo>();
  private readonly initialized = new Set<string>();
  private readonly disposed = new Set<string>();

  constructor(providers: readonly AiProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: AiProvider): AiProviderInfo {
    const info = validateProvider(provider);
    if (this.providers.has(info.id)) {
      throw new Error(`AI provider with id "${info.id}" is already registered.`);
    }
    this.providers.set(info.id, provider);
    this.infos.set(info.id, info);
    this.disposed.delete(info.id);
    return cloneInfo(info);
  }

  unregister(id: string): boolean {
    const existed = this.providers.delete(id);
    this.infos.delete(id);
    this.initialized.delete(id);
    this.disposed.delete(id);
    return existed;
  }

  get(id: string): AiProvider | undefined {
    return this.providers.get(id);
  }

  require(id: string): AiProvider {
    const provider = this.providers.get(id);
    if (provider === undefined) {
      throw new Error(`Unknown AI provider "${id}".`);
    }
    return provider;
  }

  info(id: string): AiProviderInfo | undefined {
    const info = this.infos.get(id);
    return info === undefined ? undefined : cloneInfo(info);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  supportsDifficulty(id: string, difficulty: AiDifficulty): boolean {
    const info = this.infos.get(id);
    return info !== undefined && info.capabilities.difficulties.includes(difficulty);
  }

  list(): AiProviderInfo[] {
    return Array.from(this.infos.values(), cloneInfo);
  }

  get size(): number {
    return this.providers.size;
  }

  /** Calls every provider's optional `init()`, rolling back on failure. */
  async initialize(): Promise<void> {
    for (const [id, provider] of this.providers) {
      if (this.initialized.has(id) || this.disposed.has(id)) continue;
      if (typeof provider.init === 'function') {
        await provider.init();
      }
      this.initialized.add(id);
    }
  }

  /** Calls every provider's optional `dispose()`. Errors are aggregated. */
  async disposeAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const [id, provider] of this.providers) {
      if (!this.initialized.has(id) || this.disposed.has(id)) continue;
      try {
        if (typeof provider.dispose === 'function') {
          await provider.dispose();
        }
      } catch (error) {
        errors.push(error);
      } finally {
        this.disposed.add(id);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more AI providers failed to dispose.');
    }
  }
}

function cloneInfo(info: AiProviderInfo): AiProviderInfo {
  return {
    ...info,
    capabilities: {
      ...info.capabilities,
      difficulties: [...info.capabilities.difficulties],
    },
  };
}

/**
 * Build a registry containing the built-in placeholder engine followed by any
 * caller-supplied providers. Duplicate IDs fail loudly at startup.
 */
export function createAiProviderRegistry(
  providers: readonly AiProvider[] = [],
): AiProviderRegistry {
  const registry = new AiProviderRegistry([createSimpleAiProvider(), ...providers]);
  return registry;
}

export { createSimpleAiProvider };
