import { atom, read, update } from 'claude-code';
import type { Register, Timer } from 'claude-code';

import type { Hero, Phase, QuestEntry } from '../types';
import {
  STORE_KEY,
  applyOutcome,
  bar,
  frameFor,
  levelProgress,
  moodLine,
  newHero,
  persistable,
  restore,
} from './game';

const PANE = 'companion';
const TITLE = 'Companion';
const LOG_LIMIT = 60;

const hero = atom({ plugin: 'code-companion', key: 'hero' } as const, newHero());
const log = atom({ plugin: 'code-companion', key: 'log' } as const, [] as QuestEntry[]);
const phase = atom({ plugin: 'code-companion', key: 'phase' } as const, 'idle' as Phase);
const frame = atom({ plugin: 'code-companion', key: 'frame' } as const, 0);

// Module-local, so a reload starts them over; the hero and the log live in $.state and stay.
const touched = new Set<string>();
let ticker: Timer | null = null;
let turnActive = false;
let entryCount = 0;

const stamp = (entry: Omit<QuestEntry, 'id'>): QuestEntry => {
  entryCount += 1;
  return { ...entry, id: `q-${entryCount}` };
};

/** The phase the companion rests in when nothing transient is showing. */
const restingPhase = (): Phase => (turnActive ? 'thinking' : 'idle');

type Engine = Parameters<Parameters<Register>[0]>[2] extends infer H
  ? H extends (dollar: infer D, ...rest: never[]) => unknown
    ? D
    : never
  : never;

/** Writes the hero's progress to the cross-session store, so the next session picks it up. */
const save = ($: Engine, current: Hero) => $.store.set(STORE_KEY, persistable(current));

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'companion',
      description: 'Open the companion pane; "reset" starts a new character',
    });
    // Open wherever a surface can seat a pane: the desktop app's Code tab draws one even though
    // the session it starts is not an interactive terminal, so `isInteractive` is no guide here.
    void $.ui.open({ id: PANE, title: TITLE }).then((opened) => {
      if (!opened.isPlaced) $.ui.toast('companion: no room for the pane here; /companion opens it later');
    });

    // A hot reload runs session.start again; only a session that has not yet written its hero
    // restores from the store, so a reload neither double-counts the session nor undoes progress.
    const held = await $.state.get({ plugin: 'code-companion', key: 'hero' } as const);
    if (held.value === undefined) {
      const saved = restore(await $.store.get(STORE_KEY));
      if (saved) {
        await update($, hero, () => saved);
        await update($, log, () => [
          stamp({
            glyph: '✦',
            text: `welcome back · session ${saved.sessions}, level ${saved.level}`,
            tone: 'subtle',
          }),
        ]);
      }
      await save($, await read($, hero));
    }

    $.ui.status(moodLine(await read($, hero), await read($, phase)));
    return next(e);
  });

  on('command.run', { command: 'companion' }, async ($, e) => {
    if (e.args.trim() === 'reset') {
      touched.clear();
      await update($, hero, () => newHero());
      await update($, log, () => [stamp({ glyph: '✦', text: 'a new companion joins you', tone: 'subtle' })]);
      await update($, phase, () => restingPhase());
      await save($, newHero());
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE });
    if (!opened.isPlaced) $.ui.toast('companion: widen the window to see the pane');
    return { text: e.args.trim() === 'reset' ? 'Companion reset.' : 'Companion pane opened.' };
  });

  on('turn.start', async ($, e, next) => {
    turnActive = true;
    const current = await read($, hero);
    if (current.hp === 0) {
      // A new turn revives a downed companion at half strength.
      await update($, hero, (h) => ({ ...h, hp: Math.ceil(h.maxHp / 2), streak: 0 }));
      await update($, log, (list) =>
        [stamp({ glyph: '♥', text: 'back on your feet', tone: 'success' }), ...list].slice(0, LOG_LIMIT),
      );
    }
    await update($, phase, () => 'thinking');
    ticker?.cancel();
    ticker = $.clock.every(700, () => update($, frame, (n) => n + 1));
    $.ui.status(moodLine(await read($, hero), 'thinking'));
    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool);
    await update($, hero, (h) => ({ ...h, casting: tool }));
    await update($, phase, () => 'working');
    $.ui.status(moodLine(await read($, hero), 'working'));

    const ran = await next(e);
    const isError = ran.deny === undefined && ran.isError === true;
    const file = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : undefined;
    const command = 'command' in e && typeof e.command === 'string' ? e.command : undefined;

    const before = await read($, hero);
    const applied = applyOutcome(before, { tool, isError, file, command }, touched);
    if (file) touched.add(file);
    await update($, hero, () => applied.hero);
    await update($, log, (list) => [...applied.entries.map(stamp), ...list].slice(0, LOG_LIMIT));
    await save($, applied.hero);

    const shown: Phase = applied.phase === 'idle' ? restingPhase() : applied.phase;
    await update($, phase, () => shown);
    if (shown === 'hurt' || shown === 'victory') {
      $.clock.after(2500, () =>
        update($, phase, (p) => (p === 'hurt' || p === 'victory' ? restingPhase() : p)),
      );
    }
    if (applied.leveledUp) $.ui.toast(`★ Companion reached level ${applied.hero.level}`);
    if (applied.wentDown) $.ui.toast('☠ Companion is down. The next turn revives it.');
    $.ui.status(moodLine(applied.hero, shown));

    return ran;
  }).catch(($, e, next) =>
    // Bookkeeping must never stand between the model and its tool: on a failure the call still runs
    // (or, if it already ran, `next` replays its result).
    next(e),
  );

  on('turn.complete', async ($, e, next) => {
    turnActive = false;
    ticker?.cancel();
    ticker = null;
    const answered = e.reason === 'answer';
    const broke = e.reason === 'error';
    await update($, hero, (h) => ({
      ...h,
      casting: null,
      xp: h.xp + (answered ? 5 : 0),
      hp: Math.max(0, Math.min(h.maxHp, h.hp + (answered ? 1 : 0) - (broke ? 3 : 0))),
    }));
    const entry = answered
      ? stamp({ glyph: '✓', text: 'turn answered +5 xp +1 hp', tone: 'success' })
      : broke
        ? stamp({ glyph: '✗', text: 'turn ended in an error -3 hp', tone: 'error' })
        : stamp({ glyph: '·', text: `turn ${e.reason}`, tone: 'subtle' });
    await update($, log, (list) => [entry, ...list].slice(0, LOG_LIMIT));
    const after = await read($, hero);
    await save($, after);
    await update($, phase, () => (after.hp === 0 ? 'down' : 'idle'));
    $.ui.status(moodLine(after, after.hp === 0 ? 'down' : 'idle'));
    return next(e);
  });

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e);
    // Never `h` here: that is the JSX factory the engine compiles the tree against.
    const me = await read($, hero);
    const entries = await read($, log);
    const current = await read($, phase);
    const tick = await read($, frame);
    const sprite = frameFor(current, tick);
    const rows = e.viewport?.rows ?? 24;
    const room = Math.max(2, rows - sprite.length - 4);

    const spriteColor =
      current === 'hurt' || current === 'down' ? 'error' : current === 'victory' ? 'warning' : 'claude';
    const doing =
      current === 'down'
        ? 'down for the count'
        : me.casting
          ? `casting ${me.casting}`
          : current === 'thinking'
            ? 'thinking…'
            : current === 'victory'
              ? 'level up!'
              : 'waiting for a quest';

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box flexDirection="column">
            {sprite.map((line) => (
              <Text color={spriteColor}>{line}</Text>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text bold>Companion · Lv {me.level}</Text>
            <Text color="error">{`♥ ${bar(me.hp / me.maxHp, 10)} ${me.hp}/${me.maxHp}`}</Text>
            <Text color="warning">{`✦ ${bar(levelProgress(me.xp), 10)} ${me.xp} xp`}</Text>
            <Text dimColor>{`◆ ${me.gold} files · streak ${me.streak} · session ${me.sessions}`}</Text>
            <Text color="claude">{doing}</Text>
          </Box>
        </Box>
        <Text dimColor>── quest log ──</Text>
        {entries.length === 0 && <Text dimColor>Nothing yet. Every tool call earns experience.</Text>}
        {entries.slice(0, room).map((entry) => (
          <Text color={entry.tone} dimColor={entry.tone === 'subtle'}>
            {entry.glyph} {entry.text}
          </Text>
        ))}
      </Box>
    );
  });
};
