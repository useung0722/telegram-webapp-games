// 스파이폴(Spyfall) & 라이어 게임 룸 매니저
const LOCATIONS = [
  '비행기 안', '은행', '병원', '호텔', '군사기지', '영화관', '해적선', '우주정거장',
  '잠수함', '슈퍼마켓', '놀이공원', '대학교 강의실', '카지노', '사우나', '기차 안'
];

class SpyfallEngine {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn;
    this.rooms = {}; // roomCode -> roomState
  }

  createRoom(hostUser) {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const room = {
      code,
      hostId: hostUser.id,
      state: 'lobby', // 'lobby' | 'playing' | 'voting' | 'ended'
      players: [{ id: hostUser.id, name: hostUser.name, isHost: true }],
      location: null,
      spyId: null,
      votes: {},
      timer: null
    };
    this.rooms[code] = room;
    return room;
  }

  joinRoom(code, user) {
    const room = this.rooms[code.toUpperCase()];
    if (!room) return { ok: false, error: '방을 찾을 수 없습니다.' };
    if (room.state !== 'lobby') return { ok: false, error: '이미 게임이 진행 중입니다.' };

    if (!room.players.some(p => p.id === user.id)) {
      room.players.push({ id: user.id, name: user.name, isHost: false });
    }

    this.broadcastToRoom(code, 'spyfall_player_joined', { players: room.players });
    return { ok: true, room };
  }

  startGame(code, hostId) {
    const room = this.rooms[code.toUpperCase()];
    if (!room) return { ok: false, error: '방이 없습니다.' };
    if (room.hostId !== hostId) return { ok: false, error: '방장만 시작할 수 있습니다.' };
    if (room.players.length < 3) return { ok: false, error: '최소 3명 이상이어야 합니다.' };

    room.state = 'playing';
    room.location = LOCATIONS[Math.floor(Math.random() * LOCATIONS.length)];
    
    // 스파이 1명 랜덤 선출
    const spyIndex = Math.floor(Math.random() * room.players.length);
    room.spyId = room.players[spyIndex].id;

    // 플레이어별 개별 역할 알림
    for (const player of room.players) {
      const isSpy = (player.id === room.spyId);
      this.broadcastToRoom(code, 'spyfall_role_assigned', {
        userId: player.id,
        role: isSpy ? '스파이 (Spy)' : '시민 (Citizen)',
        location: isSpy ? '???' : room.location,
        isSpy
      });
    }

    return { ok: true };
  }

  broadcastToRoom(code, event, data) {
    this.broadcast(event, { roomCode: code, ...data });
  }
}

module.exports = {
  SpyfallEngine,
  LOCATIONS
};
