'use strict';
/**
 * Saved game history: one JSON file per game in <dataDir>/games.
 * Games are tied to their creator by a SHA-256 hash of the creator's secret key,
 * so the raw key never touches disk.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[a-f0-9-]{36}$/;

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function summarize(rec) {
  const players = rec.report?.players || [];
  const winner = players.find((p) => p.rank === 1);
  return {
    id: rec.id,
    hostHash: rec.hostHash,
    title: rec.title || '',
    code: rec.code,
    mode: rec.mode,
    eras: rec.eras || [],
    status: rec.status,
    createdAt: rec.createdAt,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    playerCount: players.length,
    questionCount: rec.questionCount,
    questionsPlayed: (rec.report?.rounds || rec.report?.questions || []).filter((q) => q.revealed).length,
    winner: winner ? { nickname: winner.nickname, score: winner.score } : null,
    avgAccuracy: players.length
      ? players.reduce((s, p) => s + (p.stats.accuracy || 0), 0) / players.length
      : null,
  };
}

function createStorage(dataDir) {
  const dir = path.join(dataDir, 'games');
  fs.mkdirSync(dir, { recursive: true });
  const index = new Map(); // id -> summary
  const queues = new Map(); // id -> pending write promise (writes per game are serialized)

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      // A game still "in_progress" on startup was cut off by a restart.
      if (rec.status === 'in_progress') rec.status = 'interrupted';
      index.set(rec.id, summarize(rec));
    } catch (e) {
      console.warn(`[storage] ${f} оқылмады: ${e.message}`);
    }
  }

  function file(id) {
    return path.join(dir, `${id}.json`);
  }

  async function write(rec) {
    const tmp = `${file(rec.id)}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(rec));
    await fsp.rename(tmp, file(rec.id));
  }

  return {
    hashKey,
    /** Save (or overwrite) a game record. Returns a promise. */
    save(rec) {
      index.set(rec.id, summarize(rec));
      const prev = queues.get(rec.id) || Promise.resolve();
      const next = prev
        .then(() => write(rec))
        .catch((e) => console.error(`[storage] ${rec.id} сақталмады: ${e.message}`));
      queues.set(rec.id, next);
      next.finally(() => {
        if (queues.get(rec.id) === next) queues.delete(rec.id);
      });
      return next;
    },
    list(hostKey) {
      const h = hashKey(hostKey);
      return [...index.values()]
        .filter((s) => s.hostHash === h)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(({ hostHash, ...rest }) => rest);
    },
    async get(id, hostKey) {
      if (!ID_RE.test(id)) return null;
      const s = index.get(id);
      if (!s || s.hostHash !== hashKey(hostKey)) return null;
      await (queues.get(id) || Promise.resolve());
      const rec = JSON.parse(await fsp.readFile(file(id), 'utf8'));
      if (rec.status === 'in_progress' && s.status === 'interrupted') rec.status = 'interrupted';
      const { hostHash, ...rest } = rec;
      return rest;
    },
    async remove(id, hostKey) {
      if (!ID_RE.test(id)) return false;
      const s = index.get(id);
      if (!s || s.hostHash !== hashKey(hostKey)) return false;
      await (queues.get(id) || Promise.resolve());
      index.delete(id);
      await fsp.rm(file(id), { force: true });
      return true;
    },
    /** Wait for all pending writes (used on shutdown and in tests). */
    async flush() {
      await Promise.all([...queues.values()]);
    },
  };
}

module.exports = { createStorage, hashKey };
