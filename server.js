const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

const ARENA = { width: 1000, height: 600 };
const PLAYER_RADIUS = 16;
const HIT_RADIUS = 22;
const PLAYER_SPEED = 280; // units/second
const FIRE_RANGE = 1200;
const FIRE_COOLDOWN_MS = 160;
const DAMAGE = 34;
const RESPAWN_MS = 1500;
const RESPAWN_PROTECT_MS = 2200;
const SAFE_RESPAWN_MIN_DIST = 420;
const MAX_HP = 100;
const TICK_RATE = 60;
const SPAWN_POINTS = [
  { x: 120, y: 120 },
  { x: 120, y: ARENA.height - 120 },
  { x: ARENA.width / 2, y: 90 },
  { x: ARENA.width / 2, y: ARENA.height - 90 },
  { x: ARENA.width - 120, y: 120 },
  { x: ARENA.width - 120, y: ARENA.height - 120 }
];

// roomCode -> { players: Map<socketId, PlayerState> }
const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function createUniqueRoomCode() {
  for (let i = 0; i < 20; i++) {
    const code = makeRoomCode();
    if (!rooms.has(code)) return code;
  }
  return `${makeRoomCode()}${Date.now().toString().slice(-2)}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function spawnPoint(index) {
  const left = { x: 150, y: ARENA.height / 2 };
  const right = { x: ARENA.width - 150, y: ARENA.height / 2 };
  return index === 0 ? left : right;
}

function chooseSafeSpawn(room, respawnId) {
  const now = Date.now();
  const enemies = [];
  for (const [id, p] of room.players) {
    if (id === respawnId) continue;
    if (p.deadUntil > now) continue;
    enemies.push(p);
  }

  if (enemies.length === 0) return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];

  // Build candidate points (base spawns + small offsets) so respawn is less predictable.
  const candidates = [];
  for (const sp of SPAWN_POINTS) {
    candidates.push({ x: sp.x, y: sp.y });
    candidates.push({ x: clamp(sp.x + 60, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS), y: sp.y });
    candidates.push({ x: clamp(sp.x - 60, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS), y: sp.y });
    candidates.push({ x: sp.x, y: clamp(sp.y + 60, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS) });
    candidates.push({ x: sp.x, y: clamp(sp.y - 60, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS) });
  }

  let bestSpawn = candidates[0];
  let bestMinDistSq = -1;
  const safeMinDistSq = SAFE_RESPAWN_MIN_DIST * SAFE_RESPAWN_MIN_DIST;

  for (const sp of candidates) {
    let minDistSq = Number.POSITIVE_INFINITY;
    for (const enemy of enemies) {
      const d = distanceSquared(sp.x, sp.y, enemy.x, enemy.y);
      if (d < minDistSq) minDistSq = d;
    }

    if (minDistSq < safeMinDistSq) {
      continue;
    }

    if (minDistSq > bestMinDistSq) {
      bestMinDistSq = minDistSq;
      bestSpawn = sp;
    }
  }

  // Fallback: if no point reaches safe threshold, still use farthest point.
  if (bestMinDistSq < 0) {
    for (const sp of candidates) {
      let minDistSq = Number.POSITIVE_INFINITY;
      for (const enemy of enemies) {
        const d = distanceSquared(sp.x, sp.y, enemy.x, enemy.y);
        if (d < minDistSq) minDistSq = d;
      }
      if (minDistSq > bestMinDistSq) {
        bestMinDistSq = minDistSq;
        bestSpawn = sp;
      }
    }
  }

  return bestSpawn;
}

function makePlayer(slot) {
  const p = spawnPoint(slot);
  return {
    x: p.x,
    y: p.y,
    aimX: p.x + (slot === 0 ? 1 : -1),
    aimY: p.y,
    hp: MAX_HP,
    kills: 0,
    deaths: 0,
    input: { up: false, down: false, left: false, right: false, aimX: p.x, aimY: p.y },
    lastFireAt: 0,
    deadUntil: 0,
    spawnShieldUntil: Date.now() + RESPAWN_PROTECT_MS
  };
}

function resetPlayerForNewMatch(player, slot) {
  const p = spawnPoint(slot);
  player.x = p.x;
  player.y = p.y;
  player.aimX = p.x + (slot === 0 ? 1 : -1);
  player.aimY = p.y;
  player.hp = MAX_HP;
  player.kills = 0;
  player.deaths = 0;
  player.lastFireAt = 0;
  player.deadUntil = 0;
  player.spawnShieldUntil = Date.now() + RESPAWN_PROTECT_MS;
  player.input = { up: false, down: false, left: false, right: false, aimX: player.aimX, aimY: player.aimY };
}

function resetMatch(room) {
  room.matchOver = false;
  room.winnerId = null;
  room.restartPending = false;
  room.restartRequesterId = null;
  room.restartVotes = new Set();

  let slot = 0;
  for (const player of room.players.values()) {
    resetPlayerForNewMatch(player, slot);
    slot += 1;
  }
}

function getRoomStateForClient(room, selfId) {
  const players = {};
  for (const [id, p] of room.players) {
    players[id] = {
      x: p.x,
      y: p.y,
      aimX: p.aimX,
      aimY: p.aimY,
      hp: p.hp,
      kills: p.kills,
      deaths: p.deaths,
      isDead: p.deadUntil > Date.now(),
      isShielded: p.spawnShieldUntil > Date.now()
    };
  }

  return {
    arena: ARENA,
    you: selfId,
    players,
    scoreLimit: room.scoreLimit,
    matchOver: room.matchOver,
    winnerId: room.winnerId,
    restartPending: room.restartPending,
    restartRequesterId: room.restartRequesterId
  };
}

function resolveShoot(room, shooterId, shotAim) {
  const now = Date.now();
  const shooter = room.players.get(shooterId);
  if (!shooter) return null;
  if (room.matchOver) return null;
  if (shooter.deadUntil > now) return null;
  if (shooter.spawnShieldUntil > now) return null;
  if (now - shooter.lastFireAt < FIRE_COOLDOWN_MS) return null;

  shooter.lastFireAt = now;

  if (shotAim && Number.isFinite(shotAim.aimX) && Number.isFinite(shotAim.aimY)) {
    shooter.aimX = shotAim.aimX;
    shooter.aimY = shotAim.aimY;
  }

  const dx = shooter.aimX - shooter.x;
  const dy = shooter.aimY - shooter.y;
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;

  const rangeSq = FIRE_RANGE * FIRE_RANGE;

  let bestTargetId = null;
  let bestAlong = Number.POSITIVE_INFINITY;

  for (const [targetId, target] of room.players) {
    if (targetId === shooterId) continue;
    if (target.deadUntil > now) continue;
    if (target.spawnShieldUntil > now) continue;

    const tx = target.x - shooter.x;
    const ty = target.y - shooter.y;
    const along = tx * dirX + ty * dirY;
    if (along < 0 || along * along > rangeSq) continue;

    const perpX = tx - along * dirX;
    const perpY = ty - along * dirY;
    const perpSq = perpX * perpX + perpY * perpY;
    if (perpSq > HIT_RADIUS * HIT_RADIUS) continue;

    if (along < bestAlong) {
      bestAlong = along;
      bestTargetId = targetId;
    }
  }

  let hit = false;
  let endX = shooter.x + dirX * FIRE_RANGE;
  let endY = shooter.y + dirY * FIRE_RANGE;

  if (bestTargetId) {
    const target = room.players.get(bestTargetId);
    if (target) {
      hit = true;
      endX = target.x;
      endY = target.y;

      target.hp = clamp(target.hp - DAMAGE, 0, MAX_HP);
      if (target.hp <= 0) {
        target.deaths += 1;
        shooter.kills += 1;
        target.deadUntil = now + RESPAWN_MS;
        if (shooter.kills >= room.scoreLimit) {
          room.matchOver = true;
          room.winnerId = shooterId;
        }
      }
    }
  }

  return {
    shooterId,
    startX: shooter.x,
    startY: shooter.y,
    endX,
    endY,
    hit
  };
}

io.on("connection", (socket) => {
  socket.on("create_room", () => {
    const roomCode = createUniqueRoomCode();
    const room = {
      players: new Map(),
      ownerId: socket.id,
      scoreLimit: 5,
      matchOver: false,
      winnerId: null,
      restartPending: false,
      restartRequesterId: null,
      restartVotes: new Set()
    };
    rooms.set(roomCode, room);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;

    room.players.set(socket.id, makePlayer(0));
    socket.emit("room_created", { roomCode });
    io.to(roomCode).emit("room_info", { roomCode, count: room.players.size, max: 2 });
  });

  socket.on("join_room", ({ roomCode }) => {
    if (!roomCode || typeof roomCode !== "string") {
      socket.emit("join_failed", { reason: "Invalid room code" });
      return;
    }

    const code = roomCode.trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("join_failed", { reason: "Room not found" });
      return;
    }
    if (room.players.size >= 2) {
      socket.emit("join_failed", { reason: "Room is full" });
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;
    room.players.set(socket.id, makePlayer(1));
    room.restartPending = false;
    room.restartRequesterId = null;
    room.restartVotes = new Set();
    io.to(code).emit("room_info", { roomCode: code, count: room.players.size, max: 2 });
    if (room.players.size === 2) {
      io.to(code).emit("match_ready");
    }
  });

  socket.on("set_score_limit", ({ limit }) => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) return;
    if (socket.id !== room.ownerId) return;

    const parsed = Number(limit);
    if (!Number.isFinite(parsed)) return;
    room.scoreLimit = clamp(Math.floor(parsed), 1, 50);
    io.to(roomCode).emit("room_settings", { scoreLimit: room.scoreLimit });

    if (room.matchOver) return;
    for (const [id, p] of room.players) {
      if (p.kills >= room.scoreLimit) {
        room.matchOver = true;
        room.winnerId = id;
        io.to(roomCode).emit("match_over", { winnerId: id });
        break;
      }
    }
  });

  socket.on("request_restart", () => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) return;
    if (room.players.size < 2) {
      socket.emit("restart_error", { reason: "Need 2 players to restart." });
      return;
    }

    room.restartPending = true;
    room.restartRequesterId = socket.id;
    room.restartVotes = new Set([socket.id]);
    io.to(roomCode).emit("restart_requested", { requesterId: socket.id });
  });

  socket.on("respond_restart", ({ accept }) => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) return;
    if (!room.restartPending) return;
    if (!room.players.has(socket.id)) return;

    if (!accept) {
      room.restartPending = false;
      room.restartRequesterId = null;
      room.restartVotes = new Set();
      io.to(roomCode).emit("restart_cancelled", { reason: "Restart declined." });
      return;
    }

    room.restartVotes.add(socket.id);
    if (room.restartVotes.size >= room.players.size && room.players.size === 2) {
      resetMatch(room);
      io.to(roomCode).emit("match_restarted");
    }
  });

  socket.on("player_input", (input) => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    player.input = {
      up: !!input?.up,
      down: !!input?.down,
      left: !!input?.left,
      right: !!input?.right,
      aimX: Number.isFinite(input?.aimX) ? input.aimX : player.aimX,
      aimY: Number.isFinite(input?.aimY) ? input.aimY : player.aimY
    };
  });

  socket.on("shoot", (shotAim) => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) return;
    const shot = resolveShoot(room, socket.id, shotAim);
    if (shot) {
      io.to(roomCode).emit("shot_fired", shot);
      if (room.matchOver && room.winnerId) {
        io.to(roomCode).emit("match_over", { winnerId: room.winnerId });
      }
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players.delete(socket.id);
    if (room.ownerId === socket.id) {
      const next = room.players.keys().next();
      room.ownerId = next.done ? null : next.value;
    }

    if (room.restartPending) {
      room.restartPending = false;
      room.restartRequesterId = null;
      room.restartVotes = new Set();
    }

    io.to(roomCode).emit("opponent_left");
    io.to(roomCode).emit("room_info", { roomCode, count: room.players.size, max: 2 });

    if (room.players.size === 0) {
      rooms.delete(roomCode);
    }
  });
});

const TICK_MS = Math.floor(1000 / TICK_RATE);
setInterval(() => {
  const now = Date.now();
  const dt = TICK_MS / 1000;

    for (const [roomCode, room] of rooms) {
    let index = 0;
    for (const player of room.players.values()) {
      if (room.matchOver) {
        index += 1;
        continue;
      }

      if (player.deadUntil > now) {
        index += 1;
        continue;
      }

      if (player.hp <= 0) {
        player.hp = MAX_HP;
        const sp = spawnPoint(index);
        player.x = sp.x;
        player.y = sp.y;
      }

      const x = (player.input.right ? 1 : 0) - (player.input.left ? 1 : 0);
      const y = (player.input.down ? 1 : 0) - (player.input.up ? 1 : 0);
      const mag = Math.hypot(x, y);

      if (mag > 0) {
        const nx = x / mag;
        const ny = y / mag;
        player.x += nx * PLAYER_SPEED * dt;
        player.y += ny * PLAYER_SPEED * dt;
      }

      player.x = clamp(player.x, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS);
      player.y = clamp(player.y, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS);

      player.aimX = player.input.aimX;
      player.aimY = player.input.aimY;
      index += 1;
    }

    // Respawn players whose timer completed.
    index = 0;
    for (const [playerId, player] of room.players) {
      if (room.matchOver) {
        index += 1;
        continue;
      }
      if (player.deadUntil > 0 && player.deadUntil <= now) {
        const sp = chooseSafeSpawn(room, playerId);
        player.deadUntil = 0;
        player.hp = MAX_HP;
        player.x = sp.x;
        player.y = sp.y;
        player.spawnShieldUntil = now + RESPAWN_PROTECT_MS;
      }
      index += 1;
    }

    for (const socketId of room.players.keys()) {
      io.to(socketId).emit("state", getRoomStateForClient(room, socketId));
    }

    if (room.players.size === 0) {
      rooms.delete(roomCode);
    }
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`1v1 server running on http://localhost:${PORT}`);
});
