import type { Hero, Phase, QuestEntry } from '../types';

/** A fresh companion at the start of a session. */
export const newHero = (): Hero => ({
  xp: 0,
  hp: 20,
  maxHp: 20,
  gold: 0,
  streak: 0,
  casting: null,
  level: 1,
  sessions: 1,
});

/** The key the companion is kept under in the cross-session store. */
export const STORE_KEY = 'hero';

/** What survives a session: progress, not the moment-to-moment state. */
export const persistable = (hero: Hero) => ({
  xp: hero.xp,
  hp: hero.hp,
  maxHp: hero.maxHp,
  gold: hero.gold,
  level: hero.level,
  sessions: hero.sessions,
});

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * A hero rebuilt from a stored record, or null when nothing usable is there. A new session starts
 * rested (at least half health), with no spell in flight and the streak reset.
 */
export const restore = (saved: unknown): Hero | null => {
  if (!saved || typeof saved !== 'object') return null;
  const s = saved as Record<string, unknown>;
  if (!isCount(s.xp) || !isCount(s.maxHp) || s.maxHp === 0) return null;
  const maxHp = s.maxHp;
  const hp = isCount(s.hp) ? Math.min(maxHp, Math.max(Math.ceil(maxHp / 2), s.hp)) : maxHp;
  return {
    xp: s.xp,
    hp,
    maxHp,
    gold: isCount(s.gold) ? s.gold : 0,
    streak: 0,
    casting: null,
    level: Math.max(isCount(s.level) ? s.level : 1, levelFor(s.xp)),
    sessions: (isCount(s.sessions) ? s.sessions : 0) + 1,
  };
};

/** Level grows with the square root of experience: quick early levels, slower later ones. */
export const levelFor = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1;

/** Experience needed to reach the next level after `level`. */
export const xpForLevel = (level: number): number => (level - 1) * (level - 1) * 10;

/** How far the hero is into the current level, as a 0..1 fraction. */
export const levelProgress = (xp: number): number => {
  const level = levelFor(xp);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  return ceiling === floor ? 1 : Math.min(1, (xp - floor) / (ceiling - floor));
};

/** A tool call's outcome, reduced to what the game cares about. */
export type Outcome = {
  tool: string;
  isError: boolean;
  /** For Edit and Write, the file touched. */
  file?: string;
  /** For Bash, the command, so a test or build run can be recognised. */
  command?: string;
};

const TEST_OR_BUILD = /\b(vitest|jest|npm (test|run (test|ci|build|lint|typecheck))|pytest|cargo (test|build)|go test|tsc\b)/;

/** What a tool outcome is worth. */
export const rewardFor = (outcome: Outcome): { xp: number; hp: number; glyph: string; label: string } => {
  if (outcome.isError) return { xp: 0, hp: -2, glyph: '✗', label: `${outcome.tool} failed` };
  if (outcome.tool === 'Edit' || outcome.tool === 'Write') {
    return { xp: 3, hp: 0, glyph: '✎', label: `${outcome.tool} ${shortPath(outcome.file ?? '')}` };
  }
  if (outcome.tool === 'Bash' && outcome.command && TEST_OR_BUILD.test(outcome.command)) {
    return { xp: 10, hp: 0, glyph: '⚑', label: 'checks passed' };
  }
  return { xp: 1, hp: 0, glyph: '⚔', label: outcome.tool };
};

/** Applies an outcome to the hero and says what happened, for the log and the toasts. */
export const applyOutcome = (
  hero: Hero,
  outcome: Outcome,
  touched: ReadonlySet<string>,
): { hero: Hero; entries: Omit<QuestEntry, 'id'>[]; leveledUp: boolean; wentDown: boolean; phase: Phase } => {
  const reward = rewardFor(outcome);
  const entries: Omit<QuestEntry, 'id'>[] = [];
  let hp = Math.max(0, Math.min(hero.maxHp, hero.hp + reward.hp));
  const xp = hero.xp + reward.xp;
  const streak = outcome.isError ? 0 : hero.streak + 1;
  // Five clean calls in a row heal one point: steady work is its own medicine.
  if (!outcome.isError && streak > 0 && streak % 5 === 0 && hp < hero.maxHp) {
    hp += 1;
    entries.push({ glyph: '♥', text: `streak of ${streak}, +1 HP`, tone: 'success' });
  }
  const isNewFile =
    (outcome.tool === 'Edit' || outcome.tool === 'Write') && !!outcome.file && !touched.has(outcome.file);
  const gold = hero.gold + (isNewFile ? 1 : 0);
  const level = Math.max(hero.level, levelFor(xp));
  const leveledUp = level > hero.level;
  const wentDown = hp === 0 && hero.hp > 0;

  const main: Omit<QuestEntry, 'id'> = {
    glyph: reward.glyph,
    text: `${reward.label}${reward.xp ? ` +${reward.xp} xp` : ''}${reward.hp ? ` ${reward.hp} hp` : ''}`,
    tone: outcome.isError ? 'error' : reward.xp >= 10 ? 'success' : 'text',
  };
  entries.unshift(main);
  if (leveledUp) entries.unshift({ glyph: '★', text: `level ${level}!`, tone: 'warning' });
  if (wentDown) entries.unshift({ glyph: '☠', text: 'down. the next turn revives you', tone: 'error' });

  const phase: Phase = wentDown ? 'down' : leveledUp ? 'victory' : outcome.isError ? 'hurt' : 'idle';
  return {
    hero: { ...hero, xp, hp, gold, streak, level, casting: null },
    entries,
    leveledUp,
    wentDown,
    phase,
  };
};

/** The last path segment, or the whole thing when it has none. */
export const shortPath = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

/** A bar of `width` cells, filled to `fraction`. */
export const bar = (fraction: number, width: number): string => {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

/** One sprite frame set per phase; each frame is the same width so the pane does not jitter. */
export const SPRITES: Record<Phase, string[][]> = {
  idle: [
    ['   ▄▄▄▄▄   ', '  █ ● ● █  ', '  █  ▂  █  ', '   ▀▀█▀▀   ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
    ['   ▄▄▄▄▄   ', '  █ ─ ─ █  ', '  █  ▂  █  ', '   ▀▀█▀▀   ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
  ],
  thinking: [
    ['   ▄▄▄▄▄  ·', '  █ ● ● █  ', '  █  ▂  █  ', '   ▀▀█▀▀   ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
    ['   ▄▄▄▄▄ ··', '  █ ◦ ◦ █  ', '  █  ▂  █  ', '   ▀▀█▀▀   ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
    ['   ▄▄▄▄▄ ∙·', '  █ ● ● █  ', '  █  ▂  █  ', '   ▀▀█▀▀   ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
  ],
  working: [
    ['   ▄▄▄▄▄  ╱', '  █ ● ● █╱ ', '  █  ▂  █  ', '   ▀▀█▀▀   ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
    ['   ▄▄▄▄▄   ', '  █ ● ● █─╴', '  █  ▂  █  ', '   ▀▀█▀▀   ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
    ['   ▄▄▄▄▄   ', '  █ ● ● █  ', '  █  ▂  █╲ ', '   ▀▀█▀▀  ╲', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
  ],
  hurt: [
    ['   ▄▄▄▄▄   ', '  █ > < █  ', '  █  ▃  █  ', '   ▀▀█▀▀  ✶', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
    ['   ▄▄▄▄▄   ', '  █ > < █  ', '  █  ▃  █  ', '   ▀▀█▀▀   ', '  ▟█████▙ ✶', '  █ ▐█▌ █  ', '   ▀   ▀   '],
  ],
  victory: [
    ['★  ▄▄▄▄▄  ★', '  █ ^ ^ █  ', '  █  ▿  █  ', ' ╲ ▀▀█▀▀ ╱ ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
    ['   ▄▄▄▄▄   ', '★ █ ^ ^ █ ★', '  █  ▿  █  ', ' ╲ ▀▀█▀▀ ╱ ', '  ▟█████▙  ', '  █ ▐█▌ █  ', '   ▀   ▀   '],
  ],
  down: [
    ['           ', '           ', '           ', '           ', '   ▄▄▄▄▄   ', ' ▄█ x x █▄▄', ' ▀▀▀▀▀▀▀▀▀▀'],
    ['           ', '           ', '           ', '      z    ', '   ▄▄▄▄▄ z ', ' ▄█ x x █▄▄', ' ▀▀▀▀▀▀▀▀▀▀'],
  ],
};

/** The frame to draw for a phase at a tick. */
export const frameFor = (phase: Phase, tick: number): string[] => {
  const frames = SPRITES[phase];
  const frame = frames[Math.abs(tick) % frames.length];
  return frame ?? frames[0] ?? [];
};

/** The companion's one-line mood for the status line. */
export const moodLine = (hero: Hero, phase: Phase): string => {
  const base = `⚔ Lv${hero.level} ♥${hero.hp}/${hero.maxHp} ✦${hero.xp}xp`;
  if (phase === 'down') return `${base} · down`;
  if (hero.casting) return `${base} · casting ${hero.casting}`;
  if (phase === 'thinking') return `${base} · thinking`;
  return base;
};
