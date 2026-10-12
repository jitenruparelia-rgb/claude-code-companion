import { describe, expect, test } from 'claude-code/testing';

import {
  applyOutcome,
  bar,
  frameFor,
  levelFor,
  levelProgress,
  moodLine,
  newHero,
  persistable,
  restore,
  rewardFor,
} from './game';

describe('levels', () => {
  test('start at one and grow with the square root of experience', async () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    expect(levelFor(40)).toBe(3);
    expect(levelFor(90)).toBe(4);
    expect(levelProgress(0)).toBe(0);
    expect(levelProgress(10)).toBe(0);
    expect(levelProgress(25)).toBe(0.5);
  });
});

describe('rewards', () => {
  test('a passing check is worth more than a plain call, and an error costs health', async () => {
    expect(rewardFor({ tool: 'Read', isError: false }).xp).toBe(1);
    expect(rewardFor({ tool: 'Edit', isError: false, file: 'src/a.ts' }).xp).toBe(3);
    expect(rewardFor({ tool: 'Bash', isError: false, command: 'npm test' }).xp).toBe(10);
    expect(rewardFor({ tool: 'Bash', isError: false, command: 'ls' }).xp).toBe(1);
    expect(rewardFor({ tool: 'Bash', isError: true, command: 'npm test' })).toEqual(
      expect.objectContaining({ xp: 0, hp: -2 }),
    );
  });

  test('applying outcomes levels up, counts new files once, and downs the hero at zero', async () => {
    let hero = newHero();
    const touched = new Set<string>();

    const first = applyOutcome(hero, { tool: 'Edit', isError: false, file: 'a.ts' }, touched);
    touched.add('a.ts');
    expect(first.hero.gold).toBe(1);
    const again = applyOutcome(first.hero, { tool: 'Edit', isError: false, file: 'a.ts' }, touched);
    expect(again.hero.gold).toBe(1);

    hero = { ...newHero(), xp: 9 };
    const levelled = applyOutcome(hero, { tool: 'Read', isError: false }, touched);
    expect(levelled.leveledUp).toBe(true);
    expect(levelled.hero.level).toBe(2);
    expect(levelled.phase).toBe('victory');
    expect(levelled.entries[0]?.glyph).toBe('★');

    hero = { ...newHero(), hp: 2 };
    const downed = applyOutcome(hero, { tool: 'Bash', isError: true, command: 'x' }, touched);
    expect(downed.hero.hp).toBe(0);
    expect(downed.wentDown).toBe(true);
    expect(downed.phase).toBe('down');
    expect(downed.hero.streak).toBe(0);
  });

  test('five clean calls in a row heal a point', async () => {
    let hero = { ...newHero(), hp: 10, streak: 4 };
    const healed = applyOutcome(hero, { tool: 'Read', isError: false }, new Set());
    expect(healed.hero.hp).toBe(11);
    expect(healed.entries.some((entry) => entry.glyph === '♥')).toBe(true);
  });
});

describe('persistence', () => {
  test('a stored record comes back rested, one session on, with its level kept', async () => {
    const saved = persistable({ ...newHero(), xp: 95, hp: 3, gold: 4, level: 4, sessions: 2 });
    const back = restore(saved);
    expect(back).toBeDefined();
    expect(back?.sessions).toBe(3);
    expect(back?.level).toBe(4);
    expect(back?.xp).toBe(95);
    expect(back?.gold).toBe(4);
    expect(back?.hp).toBe(10);
    expect(back?.streak).toBe(0);
    expect(back?.casting).toBe(null);
  });

  test('a stored level never falls below what the experience says', async () => {
    const back = restore({ xp: 400, maxHp: 20, level: 1 });
    expect(back?.level).toBe(7);
  });

  test('garbage in the store is ignored', async () => {
    expect(restore(undefined)).toBe(null);
    expect(restore('nope')).toBe(null);
    expect(restore({ xp: -1, maxHp: 20 })).toBe(null);
    expect(restore({ xp: 5 })).toBe(null);
  });
});

describe('drawing helpers', () => {
  test('bars fill to the fraction and sprites keep one width per phase', async () => {
    expect(bar(0, 10)).toBe('░░░░░░░░░░');
    expect(bar(0.5, 10)).toBe('█████░░░░░');
    expect(bar(1, 10)).toBe('██████████');
    for (const phase of ['idle', 'thinking', 'working', 'hurt', 'victory', 'down'] as const) {
      const widths = new Set(frameFor(phase, 0).map((line) => [...line].length));
      expect(widths.size).toBe(1);
      expect(frameFor(phase, 7).length).toBe(frameFor(phase, 0).length);
    }
  });

  test('the status line names what the companion is doing', async () => {
    const hero = { ...newHero(), level: 3, hp: 18, xp: 42 };
    expect(moodLine(hero, 'idle')).toBe('⚔ Lv3 ♥18/20 ✦42xp');
    expect(moodLine({ ...hero, casting: 'Bash' }, 'working')).toContain('casting Bash');
    expect(moodLine(hero, 'thinking')).toContain('thinking');
    expect(moodLine({ ...hero, hp: 0 }, 'down')).toContain('down');
  });
});

describe('the pane', () => {
  test('draws the hero on every surface that seats a pane', async ($) => {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'code-companion',
        surface,
        component: 'Pane',
        props: {
          title: 'Companion',
          isFocused: false,
          bodyColumns: 78,
          placement: 'dock',
          scroll: { offset: 0, bodyRows: 20 },
          view: {},
        },
        requestId: 'companion',
        viewport: { columns: 80, rows: 24 },
      });
      expect(await ui.find({ type: 'Text', text: /Companion · Lv 1/ })).toBeDefined();
      expect(await ui.find({ type: 'Text', text: /quest log/ })).toBeDefined();
      await ui.unmount();
    }
  });
});
