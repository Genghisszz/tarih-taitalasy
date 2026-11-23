'use strict';

module.exports = {
  MAX_PLAYERS: 25,
  CODE_LENGTH: 6,
  NICK_MIN: 2,
  NICK_MAX: 16,
  TITLE_MAX: 60,
  ANSWER_MAX: 48, // typed answers (Spark / Scorched Earth)
  LENGTHS: ['short', 'normal', 'long'],
  FINAL_ROUNDS: 3,
  // Rounds per game. A Scorched Earth round (3 waves) lasts about twice a Zoom round.
  PLANS: {
    zoom: { short: 8, normal: 10, long: 14 },
    spark: { short: 6, normal: 8, long: 10 },
    scorched: { short: 3, normal: 4, long: 6 },
    mix: { short: [3, 3, 1], normal: [4, 3, 2], long: [5, 4, 3] }, // zoom, spark, scorched acts (+ 3 final rounds)
  },
  // All durations in milliseconds. Tests override these to run fast.
  timings: {
    countdown: 3500, // "3-2-1" before the first round
    intro: 3000, // rules card before a round
    introLong: 5500, // rules card when the mode changes, and the "ФИНАЛ ×2" card
    questionLead: 600, // cards animate in; the clock starts after this
    zoom: 20_000,
    spark: 30_000,
    wave: 15_000, // each Scorched Earth wave
    waveReveal: 5000, // results of a wave before the next one
    sparkFreeze: 4000, // a wrong Spark guess locks the player this long
    revealAuto: 9000, // round results when auto-advance is on
    allAnsweredGrace: 800, // pause after the last answer before moving on
    lateGrace: 400, // network slack at the buzzer
    lobbyOfflineGrace: 90_000,
    endedRoomTtl: 30 * 60_000,
    idleRoomTtl: 3 * 3600_000,
    sweepInterval: 15_000,
  },
};
