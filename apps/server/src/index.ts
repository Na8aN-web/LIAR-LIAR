import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MIN_PLAYERS } from '@wtc/shared';
import { createGameServer } from './server';

const devMode = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3001);
// Dev builds can start with fewer players so one person can test.
const minPlayers = Number(process.env.MIN_PLAYERS ?? (devMode ? 2 : MIN_PLAYERS));
const corsOrigin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true;
// One JSON line per finished game, for balance tuning. GAME_LOG=off disables it.
const gameLog = process.env.GAME_LOG === 'off' ? null : resolve(process.env.GAME_LOG ?? 'logs/games.jsonl');

const server = createGameServer({
  port,
  devMode,
  minPlayers,
  corsOrigin,
  onGameEnd: async (summary) => {
    if (!gameLog) return;
    try {
      await mkdir(dirname(gameLog), { recursive: true });
      await appendFile(gameLog, JSON.stringify(summary) + '\n');
    } catch (err) {
      console.error('could not write game log', err);
    }
  },
});
server.listen().then((p) => {
  console.log(`Wanted: True Colors server on :${p} (${devMode ? 'dev' : 'prod'}, min ${minPlayers} players)`);
  if (gameLog) console.log(`Game stats -> ${gameLog}`);
});
