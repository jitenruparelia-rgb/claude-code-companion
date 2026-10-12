/** What the companion is doing right now; picks the sprite frame set. */
export type Phase = 'idle' | 'thinking' | 'working' | 'hurt' | 'victory' | 'down';

export type Hero = {
  /** Experience points, never reset within a session. */
  xp: number;
  /** Hit points; errors take some, answers give one back. */
  hp: number;
  maxHp: number;
  /** Distinct files written or edited this session. */
  gold: number;
  /** Tool calls that came back without error, in a row. */
  streak: number;
  /** The tool running right now, if any; named in the status line and the pane. */
  casting: string | null;
  /** Highest level reached, so a level-up is announced once. */
  level: number;
  /** How many sessions this companion has been through, this one included. */
  sessions: number;
};

export type QuestEntry = {
  id: string;
  /** A one-glyph kind marker: ⚔ tool, ✎ edit, ✗ error, ★ level, ♥ heal, ☠ down. */
  glyph: string;
  text: string;
  tone: 'text' | 'success' | 'error' | 'warning' | 'subtle';
};

declare module 'claude-code' {
  interface PluginState {
    'code-companion': {
      hero: Hero;
      log: QuestEntry[];
      phase: Phase;
      /** Bumped by the ticker so the sprite animates; readers redraw on each change. */
      frame: number;
    };
  }
}
