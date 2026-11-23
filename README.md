# Тарих Тайталасы — Kazakh history quiz battle

A real-time multiplayer quiz on the whole history of Kazakhstan, fully in Kazakh,
with three game modes in the style of genioz.io: Zoom (precision), Spark (connections) and Scorched Earth (depth), plus Mix and a ×2 final.
Players join from their phones with a **room code + nickname** (no registration), up to **25 per room**.
The creator runs the game from an admin console that shows every player's answers, accuracy and time,
and every game is saved to history.

## Quick start

```bash
npm install
npm start
```

| Page | URL | Who |
| --- | --- | --- |
| Join | `http://localhost:3000/` | players (phones) |
| Create & run | `http://localhost:3000/host` | game creator / teacher |
| Saved games | `http://localhost:3000/history` | game creator |

For a classroom on one Wi-Fi, run it on a laptop and have students open `http://<laptop-ip>:3000`.
The host lobby shows the address, the big room code and a QR code.

Requires Node.js 18.17+.

## How a game works

1. The creator opens `/host` and picks a **mode** (Zoom, Spark, Scorched Earth, or Mix), the **eras** (any of the 12, or all),
   a **length** (short / normal / long), the **Final ×2**, auto-advance, and chronological order.
2. A 6-digit room code is created. Players enter the code and a nickname.
   - Nicknames are **unique per room**, case-insensitively with Kazakh letters (`Әлия` = `әлия`).
   - Max **25 players**; the 26th gets "Бөлме толы".
   - Players who refresh or lose signal rejoin automatically with the same nickname and score.
   - Players can join late; they start from the next round.
   - The creator can remove (kick) a player; that nickname can't rejoin the room.
3. Before every round a **rules card** shows the mode and how it scores. Everyone plays at the same time on their own phone.
   The round ends with a reveal: the answers, a short history fact («Білгенге маржан»), who scored what, and an animated leaderboard.
4. At the end: podium, final ranking, each player's stats, confetti. The result is already saved in history.

## Modes

Scoring lives in [`server/modes.js`](server/modes.js) as pure functions. **Points are never negative.**

| Mode | How a round works | Points |
| --- | --- | --- |
| **Зум** (Zoom, precision) | One question with three nested answer tiers (e.g. century → decade → exact year, or region → province → exact place). You pick the tier **first**, then you see only that tier's four cards and pick one. 20 s. | right at your tier: **+3 / +6 / +10**; wrong: 0 |
| **Ұшқын** (Spark, connections) | Three clues from different angles point to **one** answer. You type it (spelling is forgiving). A wrong try freezes you for 4 s, then you can try again. 30 s. | **10** if instant, falling to **2** at the buzzer; not found: 0 |
| **Күйген жер** (Scorched Earth, depth) | One category, **three waves** of 15 s. Each wave you type one answer from the category. Every answer given is **burned** for the rest of the round, and burned answers are shown to everyone. | unique valid answer: **+3 / +4 / +5**; same answer as someone else in the same wave: 0; burned/invalid/none: 0; unique in all three waves: **+3 bonus** |
| **Аралас** (Mix) | Act 1 Zoom → Act 2 Spark → Act 3 Scorched Earth → **final**: one round of each. | |
| **Финал ×2** (Final) | The last 3 rounds of any game score **double**, with a "ФИНАЛ ×2" splash before them. | ×2 |

Typed answers (Spark, Scorched Earth) are matched leniently in [`server/match.js`](server/match.js):
- Kazakh letters may be typed without their marks (Russian keyboards are fine: `Тауке` = `Тәуке`).
- Latin works (`Abylai`).
- Case, punctuation and titles like «хан», «би», «батыр» are ignored.
- Small typos are forgiven.
- A surname alone works when it is unambiguous (`Бөкейхан`).

## Admin panel (creator)

The host screen has four tabs:

- **Сахна (Stage)**: projector view. Lobby with code and QR, the rules card, the live round (for Zoom how many chose each tier,
  for Spark who has found it, for Scorched Earth the burned answers), wave results, the round reveal and the podium.
  A live ranking sidebar marks who is done.
- **Ойыншылар (Players)**: sortable table with rank, score, rounds scored / played, **accuracy %**, **average and total answer time**,
  online status and a kick button. Click a row to open that player's round-by-round breakdown: Zoom tier and card,
  every Spark guess they typed (right and wrong, with times), every Scorched Earth answer and how it was judged.
- **Жауаптар (Answers)**: a grid of every player × every round (hover a cell for the full answer).
- **Раундтар (Rounds)**: per-round breakdown: tier choices, who found the Spark answer and when, which answers were found in Scorched Earth.

Answers are never sent to phones before the reveal, and the stage hides them too, so it's safe to project.
In Zoom, a phone only receives the four cards of the tier that player chose.

**CSV export** (Excel-friendly, `;` separated, UTF-8) is available live, at the end, and from history.

### History and "no registration"

The browser that creates a game gets a random secret **creator key** (stored in `localStorage`).
Games are tied to a SHA-256 hash of that key, so only that browser sees them at `/history`.
To open your history on another computer, copy the key from `/history` → «Жүргізуші кілті» and paste it there.

Games are saved after **every round** (not only at the end), so a crash or restart keeps partial results (shown as «Үзілді», interrupted).
Files live in `data/games/*.json`. Back up this folder.

## Content: 12 eras of Kazakh history

1. Тас дәуірі · 2. Қола дәуірі · 3. Сақтар дәуірі · 4. Ғұндар, үйсіндер, қаңлылар · 5. Түрік қағанаттары ·
6. Ортағасырлық мемлекеттер · 7. Моңғол дәуірі және Алтын Орда · 8. Қазақ хандығы · 9. Жоңғар шапқыншылығы ·
10. Отарлау және ұлт-азаттық күрес · 11. Алаш және Кеңес дәуірі · 12. Кеңес кезеңінің соңы және Тәуелсіздік

| Content | Where | Count |
| --- | --- | --- |
| Zoom questions | `server/questions/data/*.json` → `zoom` (plus every "which year" question in `questions`, turned into century → decade → year tiers automatically) | 69 |
| Spark puzzles | `server/questions/data/*.json` → `spark` | 63 |
| Scorched Earth categories | `server/questions/scorched.json` (each tagged with the eras it belongs to) | 14 |

Formats (the first answer in every list is the correct / canonical one):

```json
{ "q": "«Алтын адам» қайдан табылды?", "t": [["Өңір", ["Жетісу", "Сарыарқа", "Маңғыстау", "Алтай"]], ["Облыс", ["Алматы облысы", "…", "…", "…"]], ["Қорған", ["Есік", "Бесшатыр", "Берел", "Шілікті"]]], "f": "fact shown at the reveal" }
{ "q": "Қазақ хандығы қай жылы құрылды?", "y": 1465, "f": "…" }
{ "c": ["clue 1", "clue 2", "clue 3"], "a": "Отырар", "v": ["Отрар", "Фараб"], "f": "…" }
{ "id": "handar", "eras": ["handyq", "jongar"], "cat": "Қазақ хандары", "hint": "1465–1847", "items": [["Абылай", "Әбілмансұр"], ["Тәуке", "Әз Тәуке"]] }
```

Everything is validated at startup: a broken entry stops the server with a message naming the file and item.
The tests also check that every Spark answer and every Scorched Earth item is recognised by the answer matcher.

## Configuration

| Setting | Where | Default |
| --- | --- | --- |
| Port / bind address | `PORT`, `HOST` env vars | `3000`, `0.0.0.0` |
| Data folder | `DATA_DIR` env var | `./data` |
| Max players, rounds per length, timers | `server/config.js` | 25 players; Zoom 20 s, Spark 30 s, Scorched wave 15 s |

## Deploying

It's a single Node process (Express + Socket.IO). Anything that runs Node and allows WebSockets works.
Keep `data/` on a persistent disk. Behind nginx, forward WebSocket upgrades:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Rooms live in memory, so run **one instance**. Several instances would need a Socket.IO adapter and shared storage.

## Development

```bash
npm run dev   # restarts on server changes
npm test      # scoring + answer-matching tests, and end-to-end socket games in every mode (25 players, history API)
```

```
server/
  app.js          Express routes + Socket.IO events
  rooms.js        room + round state machine, nickname rules, admin report
  modes.js        scoring for Zoom / Spark / Scorched Earth / Final
  match.js        forgiving matching of typed answers
  storage.js      saved games (JSON files)
  config.js       limits and timings
  questions/      loader, 12 era files, scorched.json
public/
  index.html      player app        (js/player.js)
  host.html       creator console   (js/host.js)
  history.html    saved games       (js/history.js)
  js/report.js    tables, answer grid, per-player drawer, CSV (shared by host + history)
  js/common.js    DOM helpers, animations, icons
  css/            design system (deep purple #2E1D5C), player and host layouts
test/             node:test suites
```

No build step: the browser loads plain ES modules. Fonts (Montserrat, Unbounded, including Kazakh Cyrillic glyphs)
are served locally from `node_modules`, so it also works offline on a local network.
