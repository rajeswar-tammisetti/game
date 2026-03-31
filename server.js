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
const PLAYER_SPEED = 280;
const FIRE_RANGE = 1200;
const FIRE_COOLDOWN_MS = 160;
const CLIP_SIZE = 8;
const RELOAD_MS = 1300;
const DAMAGE = 34;
const RESPAWN_MS = 1500;
const RESPAWN_PROTECT_MS = 2200;
const SAFE_RESPAWN_MIN_DIST = 420;
const MAX_HP = 100;
const TICK_RATE = 60;

const ROUND_COUNTDOWN_MS = 3000;
const INTER_ROUND_MS = 2200;
const ROUNDS_TO_WIN = 2; // Best of 3

const PICKUP_RESPAWN_MS = 9000;
const PICKUP_RADIUS = 26;
const SPEED_BOOST_MS = 5000;
const SPEED_MULTIPLIER = 1.45;
const HEAL_AMOUNT = 45;
const MULTIPLIER_MS = 6000;
const MULTIPLIER_MIN = 1.25;
const MULTIPLIER_MAX = 2.0;
const SHIELD_PICKUP_MS = 1800;
const TRIPLE_SHOT_MS = 5500;
const TRIPLE_SPREAD_RAD = 0.16;

const SPAWN_POINTS = [
  { x: 120, y: 120 },
  { x: 120, y: ARENA.height - 120 },
  { x: ARENA.width / 2, y: 90 },
  { x: ARENA.width / 2, y: ARENA.height - 90 },
  { x: ARENA.width - 120, y: 120 },
  { x: ARENA.width - 120, y: ARENA.height - 120 }
];

const rooms = new Map();
const clients = new Map(); // socketId -> { name, hasName, lastChatAt }
const quickQueue = [];
const pendingChallenges = new Map(); // targetId -> fromId
const activityLogs = [];
const MAX_ACTIVITY_LOGS = 150;
const CHAT_COOLDOWN_MS = 1200;
const CHAT_MAX_LEN = 120;
const globalChatMessages = [];
const MAX_GLOBAL_CHAT = 120;

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
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

function slotToSide(slot, maxPlayers = 2) {
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  return slot >= half ? "right" : "left";
}

function getOccupiedSlots(room) {
  const occupied = new Set();
  for (const p of room.players.values()) occupied.add(p.slot);
  return occupied;
}

function chooseAvailableSlot(room, preferredSide) {
  const occupied = getOccupiedSlots(room);
  const max = room.maxPlayers || 2;
  const half = Math.max(1, Math.floor(max / 2));
  const pIsLeft = preferredSide !== "right";
  
  const pStart = pIsLeft ? 0 : half;
  const pEnd = pIsLeft ? half : max;
  for (let i = pStart; i < pEnd; i++) {
    if (!occupied.has(i)) return i;
  }
  
  const oStart = pIsLeft ? half : 0;
  const oEnd = pIsLeft ? max : half;
  for (let i = oStart; i < oEnd; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}

function fmtTime(ts = Date.now()) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function pushActivity({ actorId = null, name = null, action, roomCode = null }) {
  const actorName = name || (actorId ? clients.get(actorId)?.name : null) || "System";
  const log = {
    time: Date.now(),
    timeText: fmtTime(),
    name: actorName,
    action,
    roomCode
  };
  activityLogs.unshift(log);
  if (activityLogs.length > MAX_ACTIVITY_LOGS) activityLogs.pop();
  io.emit("activity_log", log);
}

function sanitizeName(value) {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[^\w\s.-]/g, "").trim();
  return cleaned.slice(0, 16);
}

function sanitizeChatText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
}

function hasCustomName(socketId) {
  return !!clients.get(socketId)?.hasName;
}

function emitNameRequired(socket, channel = "join_failed") {
  const reason = "Set your name first (minimum 2 characters).";
  socket.emit(channel, { reason });
}

function emitChatInit(socket) {
  const roomCode = socket.data.roomCode;
  const room = roomCode ? rooms.get(roomCode) : null;
  if (room && room.players.has(socket.id)) {
    if (!Array.isArray(room.chatMessages)) room.chatMessages = [];
    socket.emit("chat_init", { messages: room.chatMessages });
    return;
  }
  socket.emit("chat_init", { messages: globalChatMessages });
}

function isSocketIdle(socketId) {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return false;
  return !socket.data.roomCode;
}

function removeFromQuickQueue(socketId) {
  let idx = quickQueue.indexOf(socketId);
  while (idx !== -1) {
    quickQueue.splice(idx, 1);
    idx = quickQueue.indexOf(socketId);
  }
}

function pushLobbySnapshot() {
  const onlineCount = clients.size;
  const waiters = [];
  for (const [id, profile] of clients) {
    if (!isSocketIdle(id)) continue;
    if (!profile.hasName) continue;
    waiters.push({ id, name: profile.name });
  }

  for (const socket of io.sockets.sockets.values()) {
    const players = waiters.filter((p) => p.id !== socket.id);
    socket.emit("lobby_snapshot", {
      onlineCount,
      queueCount: quickQueue.length,
      players
    });
  }
}

function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function baseSpawn(slot, maxPlayers = 2) {
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  const isLeft = slot < half;
  const indexInTeam = isLeft ? slot : slot - half;
  const teamSize = Math.max(1, half);
  
  const y = ARENA.height * ((indexInTeam + 1) / (teamSize + 1));
  const x = isLeft ? 150 : ARENA.width - 150;
  return { x: x + (Math.random() * 40 - 20), y: y + (Math.random() * 40 - 20) };
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

  const candidates = [];
  for (const sp of SPAWN_POINTS) {
    candidates.push({ x: sp.x, y: sp.y });
    candidates.push({ x: clamp(sp.x + 60, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS), y: sp.y });
    candidates.push({ x: clamp(sp.x - 60, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS), y: sp.y });
    candidates.push({ x: sp.x, y: clamp(sp.y + 60, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS) });
    candidates.push({ x: sp.x, y: clamp(sp.y - 60, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS) });
  }

  const safeMinDistSq = SAFE_RESPAWN_MIN_DIST * SAFE_RESPAWN_MIN_DIST;
  let best = candidates[0];
  let bestMinDistSq = -1;

  for (const sp of candidates) {
    let minDistSq = Number.POSITIVE_INFINITY;
    for (const enemy of enemies) {
      const d = distanceSquared(sp.x, sp.y, enemy.x, enemy.y);
      if (d < minDistSq) minDistSq = d;
    }
    if (minDistSq < safeMinDistSq) continue;
    if (minDistSq > bestMinDistSq) {
      best = sp;
      bestMinDistSq = minDistSq;
    }
  }

  if (bestMinDistSq >= 0) return best;

  for (const sp of candidates) {
    let minDistSq = Number.POSITIVE_INFINITY;
    for (const enemy of enemies) {
      const d = distanceSquared(sp.x, sp.y, enemy.x, enemy.y);
      if (d < minDistSq) minDistSq = d;
    }
    if (minDistSq > bestMinDistSq) {
      best = sp;
      bestMinDistSq = minDistSq;
    }
  }
  return best;
}

function createPickup() {
  return {
    active: false,
    type: null,
    x: ARENA.width / 2,
    y: ARENA.height / 2,
    nextSpawnAt: Date.now() + 3000
  };
}

function spawnPickup(room) {
  room.pickup.active = true;
  const types = ["speed", "heal", "multiplier", "shield", "triple"];
  room.pickup.type = types[Math.floor(Math.random() * types.length)];
  room.pickup.x = ARENA.width / 2;
  room.pickup.y = ARENA.height / 2;
  room.pickup.nextSpawnAt = 0;
}

function consumePickup(room, playerId) {
  const player = room.players.get(playerId);
  if (!player || !room.pickup.active) return;

  if (room.pickup.type === "speed") {
    player.speedUntil = Date.now() + SPEED_BOOST_MS;
  } else if (room.pickup.type === "heal") {
    player.hp = clamp(player.hp + HEAL_AMOUNT, 0, MAX_HP);
  } else if (room.pickup.type === "multiplier") {
    const randomMult = Math.round((MULTIPLIER_MIN + Math.random() * (MULTIPLIER_MAX - MULTIPLIER_MIN)) * 100) / 100;
    player.multiplierUntil = Date.now() + MULTIPLIER_MS;
    player.multiplierValue = randomMult;
  } else if (room.pickup.type === "shield") {
    player.spawnShieldUntil = Date.now() + SHIELD_PICKUP_MS;
  } else if (room.pickup.type === "triple") {
    player.tripleUntil = Date.now() + TRIPLE_SHOT_MS;
  }

  io.to(room.roomCode).emit("pickup_taken", {
    playerId,
    type: room.pickup.type,
    x: room.pickup.x,
    y: room.pickup.y
  });

  room.pickup.active = false;
  room.pickup.type = null;
  room.pickup.nextSpawnAt = Date.now() + PICKUP_RESPAWN_MS;
}

function makePlayer(slot, maxPlayers = 2) {
  const p = baseSpawn(slot, maxPlayers);
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  return {
    slot: slot,
    x: p.x,
    y: p.y,
    aimX: p.x + (slot < half ? 1 : -1),
    aimY: p.y,
    hp: MAX_HP,
    kills: 0, // kills for current round
    deaths: 0, // deaths for current round
    totalKills: 0,
    totalDeaths: 0,
    roundWins: 0,
    input: { up: false, down: false, left: false, right: false, aimX: p.x, aimY: p.y },
    lastFireAt: 0,
    ammo: CLIP_SIZE,
    reloadingUntil: 0,
    deadUntil: 0,
    spawnShieldUntil: Date.now() + RESPAWN_PROTECT_MS,
    speedUntil: 0,
    multiplierUntil: 0,
    multiplierValue: 1,
    tripleUntil: 0
  };
}

function resetPlayerForRound(player, slot, maxPlayers = 2) {
  const p = baseSpawn(slot, maxPlayers);
  const half = Math.max(1, Math.floor(maxPlayers / 2));
  player.slot = slot;
  player.x = p.x;
  player.y = p.y;
  player.aimX = p.x + (slot < half ? 1 : -1);
  player.aimY = p.y;
  player.hp = MAX_HP;
  player.kills = 0;
  player.deaths = 0;
  player.lastFireAt = 0;
  player.ammo = CLIP_SIZE;
  player.reloadingUntil = 0;
  player.deadUntil = 0;
  player.spawnShieldUntil = Date.now() + RESPAWN_PROTECT_MS;
  player.speedUntil = 0;
  player.multiplierUntil = 0;
  player.multiplierValue = 1;
  player.tripleUntil = 0;
  player.input = { up: false, down: false, left: false, right: false, aimX: player.aimX, aimY: player.aimY };
}

function resetMatch(room) {
  room.matchOver = false;
  room.winnerId = null;
  room.restartPending = false;
  room.restartRequesterId = null;
  room.restartVotes = new Set();
  room.roundNumber = 1;
  room.roundLive = false;
  room.roundResetAt = 0;
  room.roundCountdownUntil = Date.now() + ROUND_COUNTDOWN_MS;
  room.pickup = createPickup();

  for (const player of room.players.values()) {
    player.totalKills = 0;
    player.totalDeaths = 0;
    player.roundWins = 0;
    resetPlayerForRound(player, player.slot, room.maxPlayers || 2);
  }
}

function startNextRound(room) {
  room.roundNumber += 1;
  room.roundLive = false;
  room.roundResetAt = 0;
  room.roundCountdownUntil = Date.now() + ROUND_COUNTDOWN_MS;
  room.pickup = createPickup();

  for (const player of room.players.values()) {
    resetPlayerForRound(player, player.slot, room.maxPlayers || 2);
  }

  io.to(room.roomCode).emit("round_countdown", {
    roundNumber: room.roundNumber,
    endsAt: room.roundCountdownUntil
  });
}

function getRoomStateForClient(room, selfId) {
  const now = Date.now();
  const players = {};
  for (const [id, p] of room.players) {
    const isReloading = p.reloadingUntil > now;
    players[id] = {
      x: p.x,
      y: p.y,
      aimX: p.aimX,
      aimY: p.aimY,
      hp: p.hp,
      kills: p.kills,
      deaths: p.deaths,
      totalKills: p.totalKills,
      totalDeaths: p.totalDeaths,
      roundWins: p.roundWins,
      isDead: p.deadUntil > now,
      isShielded: p.spawnShieldUntil > now,
      hasSpeedBoost: p.speedUntil > now,
      hasMultiplier: p.multiplierUntil > now,
      multiplierValue: p.multiplierUntil > now ? p.multiplierValue : 1,
      hasTripleShot: p.tripleUntil > now,
      side: slotToSide(p.slot, room.maxPlayers || 2),
      ammo: p.ammo,
      isReloading,
      reloadEndsAt: isReloading ? p.reloadingUntil : 0,
      name: clients.get(id)?.name || "Player"
    };
  }

  return {
    arena: ARENA,
    you: selfId,
    players,
    scoreLimit: room.scoreLimit,
    roundsToWin: room.roundsToWin,
    roundNumber: room.roundNumber,
    roundLive: room.roundLive,
    roundCountdownUntil: room.roundCountdownUntil,
    matchOver: room.matchOver,
    winnerId: room.winnerId,
    restartPending: room.restartPending,
    restartRequesterId: room.restartRequesterId,
    pickup: room.pickup
  };
}

function emitRoomInfo(room) {
  const left = [];
  const right = [];
  const max = room.maxPlayers || 2;
  const half = Math.max(1, Math.floor(max / 2));
  for (const [id, p] of room.players) {
    const name = clients.get(id)?.name || "Player";
    const info = { id, name };
    if (p.slot >= half) right.push(info);
    else left.push(info);
  }
  io.to(room.roomCode).emit("room_info", {
    roomCode: room.roomCode,
    mode: room.mode || "1v1",
    count: room.players.size,
    max,
    teams: { left, right },
    ownerId: room.ownerId,
    searchingLobby: !!room.searchingLobby
  });
}

function beginReload(room, playerId, now = Date.now()) {
  const player = room.players.get(playerId);
  if (!player) return false;
  if (!room.roundLive || room.matchOver) return false;
  if (player.deadUntil > now) return false;
  if (player.reloadingUntil > now) return false;
  if (player.ammo >= CLIP_SIZE) return false;
  player.reloadingUntil = now + RELOAD_MS;
  return true;
}

function resolveSingleRay(room, shooterId, dirX, dirY, damageOut, now) {
  const shooter = room.players.get(shooterId);
  if (!shooter) return null;
  const rangeSq = FIRE_RANGE * FIRE_RANGE;
  let bestTargetId = null;
  let bestAlong = Number.POSITIVE_INFINITY;

  for (const [targetId, target] of room.players) {
    if (targetId === shooterId) continue;
    if (target.deadUntil > now) continue;
    if (target.spawnShieldUntil > now) continue;
    const maxPlayers = room.maxPlayers || 2;
    if (slotToSide(target.slot, maxPlayers) === slotToSide(shooter.slot, maxPlayers)) continue;

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
  let killed = false;
  let targetId = null;

  if (bestTargetId) {
    const target = room.players.get(bestTargetId);
    if (target) {
      hit = true;
      targetId = bestTargetId;
      endX = target.x;
      endY = target.y;

      target.hp = clamp(target.hp - damageOut, 0, MAX_HP);
      if (target.hp <= 0) {
        killed = true;
        target.deaths += 1;
        target.totalDeaths += 1;
        shooter.kills += 1;
        shooter.totalKills += 1;
        target.deadUntil = now + RESPAWN_MS;
      }
    }
  }

  return {
    shooterId,
    targetId,
    startX: shooter.x,
    startY: shooter.y,
    endX,
    endY,
    hit,
    killed,
    damage: hit ? damageOut : 0
  };
}

function resolveShoot(room, shooterId, shotAim) {
  const now = Date.now();
  const shooter = room.players.get(shooterId);
  if (!shooter) return null;
  if (!room.roundLive) return null;
  if (room.matchOver) return null;
  if (shooter.deadUntil > now) return null;
  // Spawn shield is invincibility + no-shoot window to prevent respawn advantage.
  if (shooter.spawnShieldUntil > now) return null;
  if (shooter.reloadingUntil > now) return null;
  if (shooter.ammo <= 0) {
    beginReload(room, shooterId, now);
    return null;
  }
  if (now - shooter.lastFireAt < FIRE_COOLDOWN_MS) return null;

  shooter.lastFireAt = now;
  shooter.ammo = Math.max(0, shooter.ammo - 1);

  if (shotAim && Number.isFinite(shotAim.aimX) && Number.isFinite(shotAim.aimY)) {
    shooter.aimX = shotAim.aimX;
    shooter.aimY = shotAim.aimY;
  }

  const dx = shooter.aimX - shooter.x;
  const dy = shooter.aimY - shooter.y;
  const len = Math.hypot(dx, dy) || 1;
  const baseDirX = dx / len;
  const baseDirY = dy / len;
  const damageOut = shooter.multiplierUntil > now ? Math.round(DAMAGE * shooter.multiplierValue) : DAMAGE;
  const shotAngles = shooter.tripleUntil > now ? [-TRIPLE_SPREAD_RAD, 0, TRIPLE_SPREAD_RAD] : [0];
  const shots = [];

  for (const a of shotAngles) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dirX = baseDirX * c - baseDirY * s;
    const dirY = baseDirX * s + baseDirY * c;
    const shot = resolveSingleRay(room, shooterId, dirX, dirY, damageOut, now);
    if (shot) shots.push(shot);
  }

  return shots;
}

function handleRoundWin(room, winnerId) {
  const winner = room.players.get(winnerId);
  if (!winner) return;

  room.roundLive = false;
  room.roundResetAt = 0;
  
  const max = room.maxPlayers || 2;
  const winnerSide = slotToSide(winner.slot, max);
  
  for (const p of room.players.values()) {
    if (slotToSide(p.slot, max) === winnerSide) p.roundWins += 1;
  }

  io.to(room.roomCode).emit("round_over", {
    winnerId,
    roundNumber: room.roundNumber
  });

  if (winner.roundWins >= room.roundsToWin) {
    room.matchOver = true;
    room.winnerId = winnerId;
    io.to(room.roomCode).emit("match_over", { winnerId });
    return;
  }

  room.roundResetAt = Date.now() + INTER_ROUND_MS;
}

function createRoomForPair(socketA, socketB, source = "quick_match") {
  const roomCode = createUniqueRoomCode();
  const room = {
    roomCode,
    players: new Map(),
    ownerId: socketA.id,
    scoreLimit: 5,
    roundsToWin: ROUNDS_TO_WIN,
    roundNumber: 1,
    roundLive: false,
    roundCountdownUntil: 0,
    roundResetAt: 0,
    matchOver: false,
    winnerId: null,
    restartPending: false,
    restartRequesterId: null,
    restartVotes: new Set(),
    pickup: createPickup(),
    chatMessages: []
  };
  rooms.set(roomCode, room);

  socketA.join(roomCode);
  socketB.join(roomCode);
  socketA.data.roomCode = roomCode;
  socketB.data.roomCode = roomCode;

  room.players.set(socketA.id, makePlayer(0));
  room.players.set(socketB.id, makePlayer(1));

  resetMatch(room);
  emitRoomInfo(room);
  io.to(roomCode).emit("chat_init", { messages: room.chatMessages });
  io.to(roomCode).emit("match_ready");
  io.to(roomCode).emit("round_countdown", {
    roundNumber: room.roundNumber,
    endsAt: room.roundCountdownUntil
  });
  io.to(roomCode).emit("match_created", { roomCode, source });
  pushLobbySnapshot();
}

function tryPairQuickQueue() {
  while (quickQueue.length >= 2) {
    const aId = quickQueue.shift();
    const bId = quickQueue.shift();
    const socketA = io.sockets.sockets.get(aId);
    const socketB = io.sockets.sockets.get(bId);
    if (!socketA || !socketB) continue;
    if (!isSocketIdle(aId) || !isSocketIdle(bId)) continue;
    createRoomForPair(socketA, socketB, "quick_match");
  }
}

function matchmakeLobbies() {
  const searching = [];
  for (const room of rooms.values()) {
    if (room.searchingLobby && room.players.size < room.maxPlayers) {
      searching.push(room);
    }
  }
  
  const byMode = { "2v2": [], "room": [] };
  searching.forEach(r => { if (byMode[r.mode]) byMode[r.mode].push(r); });
  
  for (const mode of Object.keys(byMode)) {
    const list = byMode[mode];
    if (list.length < 2) continue;
    
    // Sort descending by size so we fill the largest rooms first
    list.sort((a, b) => b.players.size - a.players.size);
    
    const targetRoom = list[0];
    for (let i = 1; i < list.length; i++) {
      const sourceRoom = list[i];
      if (targetRoom.players.size >= targetRoom.maxPlayers) break;
      
      const socketIds = Array.from(sourceRoom.players.keys());
      for (const socketId of socketIds) {
        if (targetRoom.players.size >= targetRoom.maxPlayers) break;
        
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;
        
        sourceRoom.players.delete(socketId);
        socket.leave(sourceRoom.roomCode);
        
        socket.join(targetRoom.roomCode);
        socket.data.roomCode = targetRoom.roomCode;
        
        const slot = chooseAvailableSlot(targetRoom, "left");
        targetRoom.players.set(socketId, makePlayer(slot, targetRoom.maxPlayers));
        
        socket.emit("room_created", { roomCode: targetRoom.roomCode });
      }
      
      if (sourceRoom.players.size === 0) {
        rooms.delete(sourceRoom.roomCode);
      } else {
        emitRoomInfo(sourceRoom);
      }
      emitRoomInfo(targetRoom);
      
      if (targetRoom.players.size >= targetRoom.maxPlayers) {
        targetRoom.searchingLobby = false;
        resetMatch(targetRoom);
        emitRoomInfo(targetRoom);
        io.to(targetRoom.roomCode).emit("match_ready");
        io.to(targetRoom.roomCode).emit("round_countdown", {
          roundNumber: targetRoom.roundNumber,
          endsAt: targetRoom.roundCountdownUntil
        });
        break;
      }
    }
  }
}

io.on("connection", (socket) => {
  console.log("[server] client connected:", socket.id);
  clients.set(socket.id, { name: "", hasName: false, lastChatAt: 0 });
  socket.emit("profile", { id: socket.id, name: clients.get(socket.id).name });
  socket.emit("activity_log_init", { logs: activityLogs.slice(0, 40) });
  pushActivity({ actorId: socket.id, action: "came online" });
  pushLobbySnapshot();

  socket.on("request_activity_logs", () => {
    socket.emit("activity_log_init", { logs: activityLogs.slice(0, 40) });
  });

  socket.on("request_lobby_snapshot", () => {
    const onlineCount = clients.size;
    const players = [];
    for (const [id, profile] of clients) {
      if (!isSocketIdle(id) || id === socket.id || !profile.hasName) continue;
      players.push({ id, name: profile.name });
    }
    socket.emit("lobby_snapshot", {
      onlineCount,
      queueCount: quickQueue.length,
      players
    });
  });

  socket.on("request_chat_init", () => {
    emitChatInit(socket);
  });

  socket.on("set_name", ({ name }) => {
    console.log("[server] set_name received from", socket.id, "name:", name);
    const trimmed = sanitizeName(name);
    if (trimmed.length < 2) {
      socket.emit("join_failed", { reason: "Name must be at least 2 characters." });
      return;
    }
    const oldName = clients.get(socket.id).name || "(unset)";
    clients.get(socket.id).name = trimmed;
    clients.get(socket.id).hasName = true;
    socket.emit("profile", { id: socket.id, name: clients.get(socket.id).name });
    pushActivity({
      actorId: socket.id,
      action: `changed name from "${oldName}" to "${clients.get(socket.id).name}"`
    });
    const rc = socket.data.roomCode;
    if (rc) {
      const room = rooms.get(rc);
      if (room) emitRoomInfo(room);
    }
    pushLobbySnapshot();
  });

  socket.on("request_quick_match", () => {
    if (!hasCustomName(socket.id)) {
      emitNameRequired(socket, "quick_match_error");
      return;
    }
    if (!isSocketIdle(socket.id)) {
      socket.emit("quick_match_error", { reason: "Already in a room." });
      return;
    }
    if (!quickQueue.includes(socket.id)) quickQueue.push(socket.id);
    socket.emit("quick_match_searching");
    pushActivity({ actorId: socket.id, action: "started quick match search" });
    tryPairQuickQueue();
    pushLobbySnapshot();
  });

  socket.on("cancel_quick_match", () => {
    removeFromQuickQueue(socket.id);
    pushActivity({ actorId: socket.id, action: "cancelled quick match search" });
    pushLobbySnapshot();
  });

  socket.on("send_challenge", ({ targetId }) => {
    if (!hasCustomName(socket.id)) {
      emitNameRequired(socket, "challenge_error");
      return;
    }
    if (!targetId || targetId === socket.id) return;
    const target = io.sockets.sockets.get(targetId);
    if (!target) return;
    if (!isSocketIdle(socket.id) || !isSocketIdle(targetId)) {
      socket.emit("challenge_error", { reason: "Target not available." });
      return;
    }
    pendingChallenges.set(targetId, socket.id);
    pushActivity({
      actorId: socket.id,
      action: `challenged ${clients.get(targetId)?.name || "Player"}`
    });
    target.emit("challenge_received", {
      fromId: socket.id,
      fromName: clients.get(socket.id)?.name || "Player"
    });
  });

  socket.on("respond_challenge", ({ fromId, accept }) => {
    const challenger = io.sockets.sockets.get(fromId);
    if (!challenger) return;
    if (!hasCustomName(socket.id) || !hasCustomName(fromId)) {
      socket.emit("challenge_error", { reason: "Both players must set names first." });
      return;
    }
    const expectedFrom = pendingChallenges.get(socket.id);
    if (expectedFrom !== fromId) {
      socket.emit("challenge_error", { reason: "Challenge expired." });
      return;
    }
    pendingChallenges.delete(socket.id);

    if (!isSocketIdle(socket.id) || !isSocketIdle(fromId)) {
      socket.emit("challenge_error", { reason: "Challenge expired." });
      challenger.emit("challenge_declined", { by: clients.get(socket.id)?.name || "Player" });
      return;
    }

    if (!accept) {
      pushActivity({
        actorId: socket.id,
        action: `declined challenge from ${clients.get(fromId)?.name || "Player"}`
      });
      challenger.emit("challenge_declined", { by: clients.get(socket.id)?.name || "Player" });
      return;
    }

    removeFromQuickQueue(socket.id);
    removeFromQuickQueue(fromId);
    pushActivity({
      actorId: socket.id,
      action: `accepted challenge from ${clients.get(fromId)?.name || "Player"}`
    });
    createRoomForPair(challenger, socket, "challenge");
    pushLobbySnapshot();
  });

  socket.on("create_room", ({ preferredSide, mode } = {}) => {
    if (!hasCustomName(socket.id)) {
      emitNameRequired(socket, "join_failed");
      return;
    }
    if (!isSocketIdle(socket.id)) {
      socket.emit("join_failed", { reason: "Already in a room" });
      return;
    }
    pendingChallenges.delete(socket.id);
    removeFromQuickQueue(socket.id);
    const roomCode = createUniqueRoomCode();
    
    let maxPlayers = 2;
    if (mode === "2v2") maxPlayers = 4;
    else if (mode === "room") maxPlayers = 10;
    
    const room = {
      roomCode,
      mode: mode || "1v1",
      maxPlayers,
      searchingLobby: false,
      players: new Map(),
      ownerId: socket.id,
      scoreLimit: 5,
      roundsToWin: ROUNDS_TO_WIN,
      roundNumber: 1,
      roundLive: false,
      roundCountdownUntil: 0,
      roundResetAt: 0,
      matchOver: false,
      winnerId: null,
      restartPending: false,
      restartRequesterId: null,
      restartVotes: new Set(),
      pickup: createPickup(),
      chatMessages: []
    };
    rooms.set(roomCode, room);

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    const slot = chooseAvailableSlot(room, preferredSide);
    room.players.set(socket.id, makePlayer(slot === null ? 0 : slot, maxPlayers));

    socket.emit("room_created", { roomCode });
    emitRoomInfo(room);
    socket.emit("chat_init", { messages: room.chatMessages });
    pushActivity({ actorId: socket.id, action: `created room ${roomCode}`, roomCode });
    pushLobbySnapshot();
  });

  socket.on("join_room", ({ roomCode, preferredSide }) => {
    if (!hasCustomName(socket.id)) {
      emitNameRequired(socket, "join_failed");
      return;
    }
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
    if (room.roundLive || room.roundCountdownUntil > 0) {
      socket.emit("join_failed", { reason: "Match already in progress" });
      return;
    }
    if (room.players.size >= (room.maxPlayers || 2)) {
      socket.emit("join_failed", { reason: "Room is full" });
      return;
    }
    if (!isSocketIdle(socket.id)) {
      socket.emit("join_failed", { reason: "Already in a room" });
      return;
    }

    pendingChallenges.delete(socket.id);
    removeFromQuickQueue(socket.id);
    socket.join(code);
    socket.data.roomCode = code;
    if (!Array.isArray(room.chatMessages)) room.chatMessages = [];
    const slot = chooseAvailableSlot(room, preferredSide);
    if (slot === null) {
      socket.emit("join_failed", { reason: "No side slot available" });
      return;
    }
    room.players.set(socket.id, makePlayer(slot, room.maxPlayers || 2));
    room.restartPending = false;
    room.restartRequesterId = null;
    room.restartVotes = new Set();
    
    emitRoomInfo(room);
    socket.emit("chat_init", { messages: room.chatMessages || [] });

    pushActivity({ actorId: socket.id, action: `joined room ${code}`, roomCode: code });
    
    // In strict 1v1, automatically start the match if full.
    if (room.mode === "1v1" && room.players.size === 2) {
      resetMatch(room);
      io.to(code).emit("match_ready");
      io.to(code).emit("round_countdown", {
        roundNumber: room.roundNumber,
        endsAt: room.roundCountdownUntil
      });
    }
    
    pushLobbySnapshot();
  });

  socket.on("choose_side", ({ side }) => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    if (room.roundLive || room.roundCountdownUntil > 0) {
      socket.emit("join_failed", { reason: "Match already started." });
      return;
    }

    const max = room.maxPlayers || 2;
    const half = Math.max(1, Math.floor(max / 2));
    
    let countOnSide = 0;
    for (const p of room.players.values()) {
      if (slotToSide(p.slot, max) === side) countOnSide++;
    }
    
    if (countOnSide >= half && slotToSide(player.slot, max) !== side) {
      socket.emit("join_failed", { reason: "Selected side is full." });
      return;
    }
    
    const occupied = getOccupiedSlots(room);
    let newSlot = null;
    const start = side === "left" ? 0 : half;
    const end = side === "left" ? half : max;
    for (let i = start; i < end; i++) {
      if (!occupied.has(i)) {
        newSlot = i;
        break;
      }
    }
    
    if (newSlot !== null && newSlot !== player.slot) {
      resetPlayerForRound(player, newSlot, max);
      emitRoomInfo(room);
    }
  });

  socket.on("start_lobby_search", ({ autofill }) => {
    const code = socket.data.roomCode;
    const room = code ? rooms.get(code) : null;
    if (!room || room.ownerId !== socket.id) return;
    
    if (room.players.size >= room.maxPlayers || !autofill) {
      resetMatch(room);
      room.searchingLobby = false;
      emitRoomInfo(room);
      io.to(code).emit("match_ready");
      io.to(code).emit("round_countdown", {
        roundNumber: room.roundNumber,
        endsAt: room.roundCountdownUntil
      });
      return;
    }
    
    room.searchingLobby = true;
    emitRoomInfo(room);
  });

  socket.on("cancel_lobby_search", () => {
    const code = socket.data.roomCode;
    const room = code ? rooms.get(code) : null;
    if (!room || room.ownerId !== socket.id) return;
    room.searchingLobby = false;
    emitRoomInfo(room);
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
    pushActivity({ actorId: socket.id, action: `set score limit to ${room.scoreLimit}`, roomCode });
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
    pushActivity({ actorId: socket.id, action: "requested restart", roomCode });
    io.to(roomCode).emit("restart_requested", { requesterId: socket.id });
  });

  socket.on("respond_restart", ({ accept }) => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room || !room.restartPending || !room.players.has(socket.id)) return;

    if (!accept) {
      room.restartPending = false;
      room.restartRequesterId = null;
      room.restartVotes = new Set();
      pushActivity({ actorId: socket.id, action: "declined restart", roomCode });
      io.to(roomCode).emit("restart_cancelled", { reason: "Restart declined." });
      return;
    }

    room.restartVotes.add(socket.id);
    if (room.restartVotes.size >= room.players.size && room.players.size === 2) {
      resetMatch(room);
      pushActivity({ actorId: socket.id, action: "accepted restart (match reset)", roomCode });
      io.to(roomCode).emit("match_restarted");
      io.to(roomCode).emit("round_countdown", {
        roundNumber: room.roundNumber,
        endsAt: room.roundCountdownUntil
      });
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

    const shots = resolveShoot(room, socket.id, shotAim);
    if (!shots || shots.length === 0) return;

    for (const shot of shots) {
      io.to(roomCode).emit("shot_fired", shot);
      if (!shot.killed) continue;
      io.to(roomCode).emit("kill_feed", {
        killerId: socket.id,
        victimId: shot.targetId,
        text: "eliminated"
      });
      const shooter = room.players.get(socket.id);
      let teamKills = 0;
      const max = room.maxPlayers || 2;
      for (const p of room.players.values()) {
        if (slotToSide(p.slot, max) === slotToSide(shooter.slot, max)) teamKills += p.kills;
      }
      if (teamKills >= room.scoreLimit) {
        handleRoundWin(room, socket.id);
      }
      pushActivity({
        actorId: socket.id,
        action: `eliminated ${clients.get(shot.targetId)?.name || "Player"}`,
        roomCode
      });
    }
  });

  socket.on("reload", () => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) return;
    beginReload(room, socket.id);
  });

  socket.on("chat_send", ({ text }) => {
    const roomCode = socket.data.roomCode;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!hasCustomName(socket.id)) {
      socket.emit("chat_error", { reason: "Set your name first." });
      return;
    }

    const profile = clients.get(socket.id);
    const now = Date.now();
    if (!profile) return;
    const waitMs = profile.lastChatAt + CHAT_COOLDOWN_MS - now;
    if (waitMs > 0) {
      socket.emit("chat_error", { reason: `Wait ${Math.ceil(waitMs / 1000)}s before sending another message.` });
      return;
    }

    const clean = sanitizeChatText(text);
    if (!clean) return;
    profile.lastChatAt = now;

    const msg = {
      time: now,
      timeText: fmtTime(now),
      senderId: socket.id,
      name: profile.name,
      text: clean
    };

    if (room && room.players.has(socket.id)) {
      if (!Array.isArray(room.chatMessages)) room.chatMessages = [];
      room.chatMessages.push(msg);
      if (room.chatMessages.length > 80) room.chatMessages.shift();
      io.to(roomCode).emit("chat_message", msg);
      return;
    }

    globalChatMessages.push(msg);
    if (globalChatMessages.length > MAX_GLOBAL_CHAT) globalChatMessages.shift();
    for (const peer of io.sockets.sockets.values()) {
      if (!peer.data.roomCode) peer.emit("chat_message", msg);
    }
  });

  socket.on("leave_room", () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      socket.emit("room_closed", { reason: "Already in lobby." });
      return;
    }
    const room = rooms.get(roomCode);
    if (!room) {
      socket.data.roomCode = null;
      socket.emit("room_closed", { reason: "Returned to lobby." });
      pushLobbySnapshot();
      return;
    }

    removeFromQuickQueue(socket.id);
    pendingChallenges.delete(socket.id);
    room.players.delete(socket.id);
    socket.leave(roomCode);
    socket.data.roomCode = null;

    if (room.ownerId === socket.id) {
      const next = room.players.keys().next();
      room.ownerId = next.done ? null : next.value;
    }

    room.restartPending = false;
    room.restartRequesterId = null;
    room.restartVotes = new Set();

    socket.emit("room_closed", { reason: "You left the match." });
    pushActivity({ actorId: socket.id, action: `left room ${roomCode}`, roomCode });

    if (room.players.size === 1) {
      const remainingId = room.players.keys().next().value;
      const remainingSocket = io.sockets.sockets.get(remainingId);
      if (remainingSocket) {
        remainingSocket.data.roomCode = null;
        remainingSocket.leave(roomCode);
        remainingSocket.emit("room_closed", { reason: "Opponent quit. Returned to lobby." });
      }
      rooms.delete(roomCode);
    } else if (room.players.size === 0) {
      rooms.delete(roomCode);
    } else {
      emitRoomInfo(room);
    }

    pushLobbySnapshot();
  });

  socket.on("disconnect", () => {
    removeFromQuickQueue(socket.id);
    pendingChallenges.delete(socket.id);
    for (const [targetId, fromId] of pendingChallenges) {
      if (fromId === socket.id || targetId === socket.id) pendingChallenges.delete(targetId);
    }
    const leavingName = clients.get(socket.id)?.name || "Player";
    clients.delete(socket.id);
    const roomCode = socket.data.roomCode;
    if (!roomCode) {
      pushActivity({ name: leavingName, action: "went offline" });
      pushLobbySnapshot();
      return;
    }
    const room = rooms.get(roomCode);
    if (!room) {
      pushActivity({ name: leavingName, action: "went offline" });
      pushLobbySnapshot();
      return;
    }

    room.players.delete(socket.id);
    if (room.ownerId === socket.id) {
      const next = room.players.keys().next();
      room.ownerId = next.done ? null : next.value;
    }

    room.restartPending = false;
    room.restartRequesterId = null;
    room.restartVotes = new Set();

    io.to(roomCode).emit("opponent_left");
    emitRoomInfo(room);

    if (room.players.size === 1) {
      // In strict 1v1, dissolve room and return remaining player to lobby state.
      const remainingId = room.players.keys().next().value;
      const remainingSocket = io.sockets.sockets.get(remainingId);
      if (remainingSocket) {
        remainingSocket.data.roomCode = null;
        remainingSocket.leave(roomCode);
        remainingSocket.emit("room_closed", { reason: "Opponent left. Returned to lobby." });
      }
      rooms.delete(roomCode);
    } else if (room.players.size === 0) {
      rooms.delete(roomCode);
    }

    pushActivity({ name: leavingName, action: `left room ${roomCode} and went offline`, roomCode });
    pushLobbySnapshot();
  });
});

const TICK_MS = Math.floor(1000 / TICK_RATE);
setInterval(() => {
  const now = Date.now();
  const dt = TICK_MS / 1000;

  matchmakeLobbies();

  for (const [roomCode, room] of rooms) {
    if (room.players.size < 2) {
      for (const socketId of room.players.keys()) io.to(socketId).emit("state", getRoomStateForClient(room, socketId));
      continue;
    }

    if (!room.matchOver && !room.roundLive && room.roundCountdownUntil > 0 && now >= room.roundCountdownUntil) {
      room.roundLive = true;
      room.roundCountdownUntil = 0;
      io.to(roomCode).emit("round_started", { roundNumber: room.roundNumber });
    }

    if (!room.matchOver && !room.roundLive && room.roundResetAt > 0 && now >= room.roundResetAt) {
      startNextRound(room);
    }

    for (const [playerId, player] of room.players) {
      if (!room.roundLive || room.matchOver) continue;

      if (player.reloadingUntil > 0 && player.reloadingUntil <= now) {
        player.reloadingUntil = 0;
        player.ammo = CLIP_SIZE;
      }

      if (player.deadUntil > now) continue;

      const speedScale = player.speedUntil > now ? SPEED_MULTIPLIER : 1;
      const x = (player.input.right ? 1 : 0) - (player.input.left ? 1 : 0);
      const y = (player.input.down ? 1 : 0) - (player.input.up ? 1 : 0);
      const mag = Math.hypot(x, y);

      if (mag > 0) {
        const nx = x / mag;
        const ny = y / mag;
        player.x += nx * PLAYER_SPEED * speedScale * dt;
        player.y += ny * PLAYER_SPEED * speedScale * dt;
      }

      player.x = clamp(player.x, PLAYER_RADIUS, ARENA.width - PLAYER_RADIUS);
      player.y = clamp(player.y, PLAYER_RADIUS, ARENA.height - PLAYER_RADIUS);
      player.aimX = player.input.aimX;
      player.aimY = player.input.aimY;

      if (room.pickup.active && distanceSquared(player.x, player.y, room.pickup.x, room.pickup.y) <= PICKUP_RADIUS * PICKUP_RADIUS) {
        consumePickup(room, playerId);
      }
    }

    for (const [playerId, player] of room.players) {
      if (!room.roundLive || room.matchOver) continue;
      if (player.deadUntil > 0 && player.deadUntil <= now) {
        const sp = chooseSafeSpawn(room, playerId);
        player.deadUntil = 0;
        player.hp = MAX_HP;
        player.ammo = CLIP_SIZE;
        player.reloadingUntil = 0;
        player.x = sp.x;
        player.y = sp.y;
        player.spawnShieldUntil = now + RESPAWN_PROTECT_MS;
        player.speedUntil = 0;
        player.multiplierUntil = 0;
        player.multiplierValue = 1;
        player.tripleUntil = 0;
      }
    }

    if (room.roundLive && !room.matchOver && !room.pickup.active && room.pickup.nextSpawnAt > 0 && now >= room.pickup.nextSpawnAt) {
      spawnPickup(room);
    }

    for (const socketId of room.players.keys()) {
      io.to(socketId).emit("state", getRoomStateForClient(room, socketId));
    }
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`1v1 server running on http://localhost:${PORT}`);
});
