import type { ContextTurn } from '../providers/types';

/**
 * Rolling memory of the conversation, used only as context for translation
 * (pronoun and term disambiguation). It is bounded and lives in RAM for the
 * duration of one WebSocket connection; nothing is written to disk.
 */
export class ConversationMemory {
  private turns: ContextTurn[] = [];

  constructor(
    private readonly maxTurns = 12,
    private readonly maxTurnChars = 400,
  ) {}

  add(turn: ContextTurn): void {
    const text = turn.text.trim();
    if (!text) return;
    this.turns.push({
      ...turn,
      text: text.length > this.maxTurnChars ? `${text.slice(0, this.maxTurnChars)}…` : text,
    });
    if (this.turns.length > this.maxTurns) this.turns.splice(0, this.turns.length - this.maxTurns);
  }

  /** The most recent turns, oldest first, limited by count and by total size. */
  recent(maxTurns = 6, maxChars = 900): ContextTurn[] {
    const selected: ContextTurn[] = [];
    let chars = 0;
    for (let i = this.turns.length - 1; i >= 0 && selected.length < maxTurns; i--) {
      const turn = this.turns[i];
      if (!turn) break;
      if (chars + turn.text.length > maxChars && selected.length > 0) break;
      chars += turn.text.length;
      selected.unshift(turn);
    }
    return selected;
  }

  clear(): void {
    this.turns = [];
  }

  get size(): number {
    return this.turns.length;
  }
}
