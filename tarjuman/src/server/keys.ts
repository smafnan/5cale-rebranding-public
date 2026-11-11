import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { KeyStatus } from '../shared/api';

/** Static description of one API key the server knows how to use. */
export interface KeyDefinition {
  /** Environment variable name. */
  name: string;
  /** Other environment variable names accepted for the same key. */
  aliases?: string[];
  label: string;
  description: string;
  signupUrl: string;
  recommended: boolean;
}

const MAX_KEY_LENGTH = 400;

/** Printable ASCII without spaces: every provider key we use matches this. */
const KEY_PATTERN = /^[\x21-\x7e]+$/;

export class KeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyValidationError';
  }
}

function mask(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Resolves API keys. The environment always wins; keys saved from the UI are kept in
 * `<dataDir>/keys.json` (mode 0600, git-ignored) and only used when the environment has none.
 *
 * Providers read keys through `get()` on every request, so a key saved in the UI takes
 * effect immediately, without a restart.
 */
export class KeyStore {
  private readonly definitions: KeyDefinition[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly filePath: string;
  private fileKeys: Record<string, string> = {};
  private readonly listeners = new Set<() => void>();

  constructor(options: { definitions: KeyDefinition[]; env?: NodeJS.ProcessEnv; dataDir: string }) {
    this.definitions = options.definitions;
    this.env = options.env ?? process.env;
    this.filePath = path.join(options.dataDir, 'keys.json');
  }

  /** Load keys saved earlier. A missing or unreadable file is treated as "no saved keys". */
  async load(): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      const next: Record<string, string> = {};
      if (parsed && typeof parsed === 'object') {
        for (const def of this.definitions) {
          const value = (parsed as Record<string, unknown>)[def.name];
          if (typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_LENGTH)
            next[def.name] = value;
        }
      }
      this.fileKeys = next;
    } catch {
      this.fileKeys = {};
    }
  }

  private fromEnv(def: KeyDefinition): string | undefined {
    for (const name of [def.name, ...(def.aliases ?? [])]) {
      const value = this.env[name]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  private definition(name: string): KeyDefinition | undefined {
    return this.definitions.find((def) => def.name === name);
  }

  get(name: string): string | undefined {
    const def = this.definition(name);
    if (!def) return undefined;
    return this.fromEnv(def) ?? this.fileKeys[name];
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  status(): KeyStatus[] {
    return this.definitions.map((def) => {
      const envValue = this.fromEnv(def);
      const value = envValue ?? this.fileKeys[def.name];
      return {
        name: def.name,
        label: def.label,
        description: def.description,
        signupUrl: def.signupUrl,
        recommended: def.recommended,
        set: value !== undefined,
        source: envValue !== undefined ? 'env' : value !== undefined ? 'file' : null,
        hint: value !== undefined ? mask(value) : null,
      };
    });
  }

  /**
   * Save or remove keys. `null` / empty removes a saved key. Unknown names and malformed
   * values are rejected before anything is written.
   */
  async update(changes: Record<string, string | null>): Promise<void> {
    const next = { ...this.fileKeys };
    for (const [name, raw] of Object.entries(changes)) {
      if (!this.definition(name)) throw new KeyValidationError(`Unknown key "${name}".`);
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) {
        delete next[name];
        continue;
      }
      if (value.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(value)) {
        throw new KeyValidationError(`The value for ${name} does not look like an API key.`);
      }
      next[name] = value;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(tmpPath, this.filePath);
    await chmod(this.filePath, 0o600).catch(() => undefined);

    this.fileKeys = next;
    for (const listener of this.listeners) listener();
  }

  /** Subscribe to key changes (used to clear "invalid key" provider states). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
