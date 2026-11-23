'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const config = require('./config');
const { ERAS } = require('./questions');
const { MODES, ZOOM, SPARK, SCORCHED, FINAL_MULTIPLIER } = require('./modes');
const { counts } = require('./questions');
const { RoomManager } = require('./rooms');
const { createStorage } = require('./storage');

const ROOT = path.join(__dirname, '..');
const HOST_KEY_RE = /^[A-Za-z0-9_-]{24,128}$/;

/** Tiny sliding-window limiter keyed by string. */
function limiter(max, windowMs) {
  const hits = new Map();
  const t = setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of hits) if (!arr.some((ts) => now - ts < windowMs)) hits.delete(k);
  }, windowMs);
  t.unref();
  return (key) => {
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
    arr.push(now);
    hits.set(key, arr);
    return arr.length <= max;
  };
}

function createApp({ dataDir = path.join(ROOT, 'data'), timings } = {}) {
  const storage = createStorage(dataDir);
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 64 * 1024, pingInterval: 10_000, pingTimeout: 8_000 });
  const manager = new RoomManager({ io, storage, timings });

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const fontOpts = { maxAge: '30d', immutable: true };
  app.use('/fonts/montserrat', express.static(path.join(ROOT, 'node_modules/@fontsource/montserrat'), fontOpts));
  app.use('/fonts/unbounded', express.static(path.join(ROOT, 'node_modules/@fontsource/unbounded'), fontOpts));
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: '5m' }));

  app.get('/api/meta', (req, res) => {
    res.json({
      maxPlayers: config.MAX_PLAYERS,
      nick: { min: config.NICK_MIN, max: config.NICK_MAX },
      lengths: config.LENGTHS,
      plans: config.PLANS,
      finalRounds: config.FINAL_ROUNDS,
      timings: { zoom: config.timings.zoom, spark: config.timings.spark, wave: config.timings.wave },
      modes: Object.values(MODES),
      rules: { ZOOM, SPARK, SCORCHED, FINAL_MULTIPLIER },
      eras: ERAS.map((e) => ({ id: e.id, order: e.order, name: e.name, period: e.period, icon: e.icon, counts: counts([e.id]) })),
    });
  });

  app.get('/api/qr', async (req, res) => {
    const text = String(req.query.text || '');
    if (!text || text.length > 300) return res.status(400).end();
    try {
      const svg = await QRCode.toString(text, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#2E1D5C', light: '#FFFFFF' },
      });
      res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
    } catch {
      res.status(500).end();
    }
  });

  // ----- saved history (creator only) -----
  function hostKeyFrom(req, res) {
    const key = req.get('x-host-key') || '';
    if (!HOST_KEY_RE.test(key)) {
      res.status(401).json({ error: 'Кілт жарамсыз' });
      return null;
    }
    return key;
  }
  app.get('/api/history', (req, res) => {
    const key = hostKeyFrom(req, res);
    if (key) res.json({ games: storage.list(key) });
  });
  app.get('/api/history/:id', async (req, res) => {
    const key = hostKeyFrom(req, res);
    if (!key) return;
    const rec = await storage.get(req.params.id, key);
    if (!rec) return res.status(404).json({ error: 'Ойын табылмады' });
    res.json(rec);
  });
  app.delete('/api/history/:id', async (req, res) => {
    const key = hostKeyFrom(req, res);
    if (!key) return;
    const ok = await storage.remove(req.params.id, key);
    res.status(ok ? 200 : 404).json({ ok });
  });

  // ----- realtime -----
  // A whole class often shares one public IP, so the per-IP cap is generous; the tight cap is
  // per connection. Together they make guessing room codes impractically slow.
  const joinLimitIp = limiter(150, 60_000);
  const joinLimitSocket = limiter(10, 60_000);
  const createLimit = limiter(20, 60_000);

  io.on('connection', (socket) => {
    socket.data = {};
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
    const reply = (ack, payload) => typeof ack === 'function' && ack(payload);
    const ownRoom = () => {
      const room = socket.data.code && manager.get(socket.data.code);
      return room && !room.destroyed ? room : null;
    };

    socket.on('host:create', (payload, ack) => {
      const { hostKey, settings } = payload || {};
      if (!HOST_KEY_RE.test(hostKey || '')) return reply(ack, { ok: false, error: 'Кілт жарамсыз' });
      if (!createLimit(ip)) return reply(ack, { ok: false, error: 'Тым жиі. Біраздан кейін қайталаңыз' });
      const room = manager.create(hostKey, settings);
      socket.join(room.hostChannel);
      socket.data = { role: 'host', code: room.code };
      room.broadcast();
      reply(ack, { ok: true, code: room.code });
    });

    socket.on('host:attach', (payload, ack) => {
      const { hostKey, code } = payload || {};
      const room = manager.get(code);
      if (!room) return reply(ack, { ok: false, code: 'ROOM_NOT_FOUND', error: 'Бөлме табылмады немесе жабылған' });
      if (!HOST_KEY_RE.test(hostKey || '') || storage.hashKey(hostKey) !== room.hostHash) {
        return reply(ack, { ok: false, code: 'FORBIDDEN', error: 'Бұл бөлмені басқаруға рұқсат жоқ' });
      }
      socket.join(room.hostChannel);
      socket.data = { role: 'host', code: room.code };
      room.touch();
      room.broadcast();
      reply(ack, { ok: true, code: room.code });
    });

    socket.on('host:action', (payload, ack) => {
      const room = ownRoom();
      if (!room || socket.data.role !== 'host') return reply(ack, { ok: false, error: 'Бөлме табылмады' });
      const { action, playerId } = payload || {};
      let res;
      switch (action) {
        case 'start':
          res = room.start();
          break;
        case 'skip':
          res = room.skip();
          break;
        case 'next':
          res = room.phase === 'reveal' ? room.nextRound() : { ok: false, error: 'Раунд әлі аяқталған жоқ' };
          break;
        case 'end':
          res = room.finish({ early: true });
          break;
        case 'kick':
          res = room.kick(String(playerId || ''));
          break;
        default:
          res = { ok: false, error: 'Белгісіз әрекет' };
      }
      reply(ack, res || { ok: true });
    });

    socket.on('player:join', (payload, ack) => {
      const { code, nickname, token } = payload || {};
      const room = manager.get(code);
      const hasToken = typeof token === 'string' && token.length > 0;
      // Reconnects carry a token and are cheap to verify, so only new joins count toward the limit.
      if (!(hasToken && room?.byToken.has(token)) && (!joinLimitSocket(socket.id) || !joinLimitIp(ip))) {
        return reply(ack, { ok: false, code: 'RATE', error: 'Тым көп әрекет. Бір минуттан кейін қайталаңыз' });
      }
      if (!room) return reply(ack, { ok: false, code: 'ROOM_NOT_FOUND', error: 'Мұндай кодпен бөлме табылмады' });
      if (socket.data.role === 'player' && socket.data.code !== room.code) {
        const prev = ownRoom();
        const p = prev?.players.get(socket.data.playerId);
        if (p) prev.leave(p);
      }
      reply(ack, room.join(socket, { nickname, token: hasToken ? token : null }));
    });

    const actLimit = limiter(40, 10_000); // typed guesses: generous, but no flooding
    socket.on('player:act', (payload, ack) => {
      const room = ownRoom();
      const p = room?.players.get(socket.data.playerId);
      if (!p || p.socketId !== socket.id) return reply(ack, { ok: false, error: 'Ойында жоқсыз' });
      if (!actLimit(socket.id)) return reply(ack, { ok: false, code: 'RATE', error: 'Тым жиі' });
      reply(ack, room.act(p, payload));
    });

    socket.on('player:leave', (_payload, ack) => {
      const room = ownRoom();
      const p = room?.players.get(socket.data.playerId);
      if (p && p.socketId === socket.id) room.leave(p);
      socket.data = {};
      reply(ack, { ok: true });
    });

    socket.on('disconnect', () => {
      const room = ownRoom();
      if (room && socket.data.role === 'player') room.onDisconnect(socket);
    });
  });

  return {
    app,
    server,
    io,
    manager,
    storage,
    listen(port, host) {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      manager.close();
      await storage.flush();
      await new Promise((resolve) => io.close(() => resolve()));
    },
  };
}

module.exports = { createApp };
