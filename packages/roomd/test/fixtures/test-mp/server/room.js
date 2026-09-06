/* Room module cho test G4. view() có mặt để test interest management:
   mỗi người chỉ được thấy `secret` của chính mình. */
module.exports = {
  config: { tickRate: 20, maxPlayers: 2 },

  initialState: function () { return { phase: 'lobby', n: 0, hits: {}, secret: {} } },

  onCreate: function (room, opts) {
    room.state.phase = 'play'
    if (opts && opts.stage) room.state.stage = opts.stage
  },

  onJoin: function (room, p) {
    room.state.hits[p.id] = 0
    room.state.secret[p.id] = 'chi-' + p.id.slice(0, 4)
  },

  onMessage: function (room, p, type, d) {
    if (type === 'bump') room.state.hits[p.id] = (room.state.hits[p.id] || 0) + 1
    else if (type === 'shout') room.broadcast('shouted', { by: p.id })
    else if (type === 'score') room.leaderboard('daily').submit(p.id, d.score)
    else if (type === 'boom') { while (true) {} }   // để test watchdog CPU
  },

  onTick: function (room) { room.state.n++ },

  onLeave: function (room, p) {
    delete room.state.hits[p.id]
    delete room.state.secret[p.id]
  },
}
