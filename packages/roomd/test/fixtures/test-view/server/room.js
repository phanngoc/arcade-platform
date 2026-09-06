/* Chỉ để test view(): mỗi người thấy tay của mình, không thấy tay người khác. */
module.exports = {
  config: { tickRate: 20, maxPlayers: 3 },
  initialState: function () { return { pot: 0, hands: {} } },
  onJoin: function (room, p) { room.state.hands[p.id] = ['A', 'K'] },
  onTick: function (room) { room.state.pot++ },
  view: function (room, p) {
    var hands = {}
    hands[p.id] = room.state.hands[p.id]
    return { pot: room.state.pot, hands: hands }
  },
}
