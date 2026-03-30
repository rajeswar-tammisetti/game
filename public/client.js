const socket = io();

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const hostBtn = document.getElementById("hostBtn");
const joinBtn = document.getElementById("joinBtn");
const setLimitBtn = document.getElementById("setLimitBtn");
const restartBtn = document.getElementById("restartBtn");
const roomInput = document.getElementById("roomInput");
const scoreLimitInput = document.getElementById("scoreLimitInput");
const roomLabel = document.getElementById("roomLabel");
const playersLabel = document.getElementById("playersLabel");
const scoreMain = document.getElementById("scoreMain");
const scoreSub = document.getElementById("scoreSub");
const restartPrompt = document.getElementById("restartPrompt");
const restartPromptText = document.getElementById("restartPromptText");
const restartAcceptBtn = document.getElementById("restartAcceptBtn");
const restartDeclineBtn = document.getElementById("restartDeclineBtn");
const statusEl = document.getElementById("status");

const input = {
  up: false,
  down: false,
  left: false,
  right: false,
  aimX: 0,
  aimY: 0
};

let localId = null;
let roomCode = null;
let players = {};
let matchReady = false;
let canShoot = true;
let lastShotAt = 0;
const tracers = [];
let scoreLimit = 5;
let matchOver = false;
let winnerId = null;
let restartPending = false;
let restartRequesterId = null;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function updateRestartPrompt() {
  const shouldShow = restartPending && localId && restartRequesterId && restartRequesterId !== localId;
  restartPrompt.style.display = shouldShow ? "block" : "none";
}

function sendInput() {
  if (!matchReady) return;
  socket.emit("player_input", input);
}

function updateScoreLabel() {
  if (!localId || !players[localId]) {
    scoreMain.textContent = "Me 0 - 0 Enemy";
    scoreSub.textContent = `First to ${scoreLimit}`;
    return;
  }

  const me = players[localId];
  const enemyEntry = Object.entries(players).find(([id]) => id !== localId);
  const enemy = enemyEntry ? enemyEntry[1] : null;

  const myKills = me.kills || 0;
  const enemyKills = enemy ? enemy.kills || 0 : 0;
  scoreMain.textContent = `Me ${myKills} - ${enemyKills} Enemy`;

  const myKD = `${me.kills || 0}/${me.deaths || 0}`;
  const enemyKD = enemy ? `${enemy.kills || 0}/${enemy.deaths || 0}` : "0/0";
  scoreSub.textContent = `First to ${scoreLimit} | K/D Me ${myKD} Enemy ${enemyKD}`;
}

hostBtn.addEventListener("click", () => {
  socket.emit("create_room");
  setStatus("Creating room...");
});

joinBtn.addEventListener("click", () => {
  const code = roomInput.value.trim().toUpperCase();
  if (!code) {
    setStatus("Enter room code first.", true);
    return;
  }
  socket.emit("join_room", { roomCode: code });
  setStatus(`Joining ${code}...`);
});

setLimitBtn.addEventListener("click", () => {
  const raw = Number(scoreLimitInput.value);
  const limit = Math.max(1, Math.min(50, Number.isFinite(raw) ? Math.floor(raw) : 5));
  scoreLimitInput.value = String(limit);
  socket.emit("set_score_limit", { limit });
});

restartBtn.addEventListener("click", () => {
  socket.emit("request_restart");
});

restartAcceptBtn.addEventListener("click", () => {
  socket.emit("respond_restart", { accept: true });
});

restartDeclineBtn.addEventListener("click", () => {
  socket.emit("respond_restart", { accept: false });
});

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w") input.up = true;
  if (k === "s") input.down = true;
  if (k === "a") input.left = true;
  if (k === "d") input.right = true;
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w") input.up = false;
  if (k === "s") input.down = false;
  if (k === "a") input.left = false;
  if (k === "d") input.right = false;
});

canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  const sx = (e.clientX - r.left) / r.width;
  const sy = (e.clientY - r.top) / r.height;
  input.aimX = clamp(sx * canvas.width, 0, canvas.width);
  input.aimY = clamp(sy * canvas.height, 0, canvas.height);
});

function tryShoot() {
  if (!matchReady) return;
  if (matchOver) return;
  if (localId && players[localId] && players[localId].isShielded) return;
  if (!canShoot) return;
  canShoot = false;
  lastShotAt = Date.now();
  socket.emit("shoot", { aimX: input.aimX, aimY: input.aimY });
  setTimeout(() => {
    canShoot = true;
  }, 120);
}

canvas.addEventListener("mousedown", () => {
  tryShoot();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    tryShoot();
  }
});

socket.on("connect", () => {
  setStatus("Connected. Create or join a room.");
});

socket.on("room_created", ({ roomCode: code }) => {
  roomCode = code;
  roomInput.value = code;
  roomLabel.textContent = `Room: ${code}`;
  setStatus("Room created. Send this code to the other player.");
});

socket.on("room_info", ({ roomCode: code, count, max }) => {
  roomCode = code;
  roomLabel.textContent = `Room: ${code}`;
  playersLabel.textContent = `Players: ${count}/${max}`;
});

socket.on("join_failed", ({ reason }) => {
  setStatus(reason || "Failed to join room.", true);
});

socket.on("match_ready", () => {
  matchReady = true;
  matchOver = false;
  winnerId = null;
  restartPending = false;
  restartRequesterId = null;
  updateRestartPrompt();
  setStatus("Match started.");
});

socket.on("opponent_left", () => {
  matchReady = false;
  matchOver = false;
  winnerId = null;
  restartPending = false;
  restartRequesterId = null;
  updateRestartPrompt();
  setStatus("Opponent left room.", true);
});

socket.on("state", (snapshot) => {
  localId = snapshot.you;
  players = snapshot.players || {};
  scoreLimit = snapshot.scoreLimit || scoreLimit;
  matchOver = !!snapshot.matchOver;
  winnerId = snapshot.winnerId || null;
  restartPending = !!snapshot.restartPending;
  restartRequesterId = snapshot.restartRequesterId || null;
  scoreLimitInput.value = String(scoreLimit);
  updateScoreLabel();
  updateRestartPrompt();

  if (matchOver) {
    setStatus(winnerId === localId ? "You won the match." : "You lost the match.", winnerId !== localId);
  }
});

socket.on("room_settings", ({ scoreLimit: limit }) => {
  if (!limit) return;
  scoreLimit = limit;
  scoreLimitInput.value = String(scoreLimit);
  updateScoreLabel();
});

socket.on("match_over", ({ winnerId: winner }) => {
  matchOver = true;
  winnerId = winner || null;
  setStatus(winnerId === localId ? "You won the match." : "You lost the match.", winnerId !== localId);
});

socket.on("restart_requested", ({ requesterId }) => {
  restartPending = true;
  restartRequesterId = requesterId || null;
  updateRestartPrompt();

  if (localId && requesterId === localId) {
    setStatus("Restart requested. Waiting for opponent to accept.");
  } else {
    restartPromptText.textContent = "Opponent requested restart. Accept?";
    setStatus("Opponent requested restart.");
  }
});

socket.on("restart_cancelled", ({ reason }) => {
  restartPending = false;
  restartRequesterId = null;
  updateRestartPrompt();
  setStatus(reason || "Restart cancelled.");
});

socket.on("restart_error", ({ reason }) => {
  setStatus(reason || "Cannot restart right now.", true);
});

socket.on("match_restarted", () => {
  matchReady = true;
  matchOver = false;
  winnerId = null;
  restartPending = false;
  restartRequesterId = null;
  tracers.length = 0;
  updateRestartPrompt();
  setStatus("Match restarted.");
});

socket.on("shot_fired", (shot) => {
  tracers.push({
    shooterId: shot.shooterId,
    startX: shot.startX,
    startY: shot.startY,
    endX: shot.endX,
    endY: shot.endY,
    hit: !!shot.hit,
    expiresAt: Date.now() + 120
  });
});

setInterval(sendInput, 1000 / 30);

function drawArena() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111722";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#263446";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

  ctx.strokeStyle = "#1f2b3a";
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 0);
  ctx.lineTo(canvas.width / 2, canvas.height);
  ctx.stroke();
}

function drawPlayer(id, p) {
  const isMe = id === localId;
  const color = isMe ? "#4f8cff" : "#ff5a70";
  const dead = p.isDead;

  if (!dead) {
    // Aim line.
    const dx = p.aimX - p.x;
    const dy = p.aimY - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;

    ctx.strokeStyle = isMe ? "#76a2ff" : "#ff8090";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + nx * 30, p.y + ny * 30);
    ctx.stroke();
  }

  ctx.fillStyle = dead ? "#4b4b4b" : color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
  ctx.fill();

  // HP bar.
  const hpRatio = clamp(p.hp / 100, 0, 1);
  ctx.fillStyle = "#2d3645";
  ctx.fillRect(p.x - 20, p.y - 28, 40, 5);
  ctx.fillStyle = hpRatio > 0.35 ? "#2cc8a3" : "#e45858";
  ctx.fillRect(p.x - 20, p.y - 28, 40 * hpRatio, 5);
}

function drawHudText() {
  if (!localId || !players[localId]) return;
  const me = players[localId];

  ctx.fillStyle = "#e8edf5";
  ctx.font = "16px Segoe UI";
  ctx.fillText(`HP: ${me.hp}`, 12, 24);

  if (me.isShielded) {
    ctx.fillStyle = "#7fe8d0";
    ctx.fillText("SPAWN SHIELD", 12, 46);
  }

  if (Date.now() - lastShotAt < 120) {
    ctx.fillStyle = "#ffd166";
    ctx.fillText("SHOT", 12, me.isShielded ? 68 : 46);
  }

  if (matchOver) {
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 42px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(winnerId === localId ? "VICTORY" : "DEFEAT", canvas.width / 2, canvas.height / 2);
    ctx.font = "18px Segoe UI";
    ctx.fillText(`First to ${scoreLimit} reached`, canvas.width / 2, canvas.height / 2 + 34);
    ctx.textAlign = "start";
  }
}

function drawTracers() {
  const now = Date.now();
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    if (t.expiresAt <= now) {
      tracers.splice(i, 1);
      continue;
    }

    const alpha = (t.expiresAt - now) / 120;
    const isMe = t.shooterId === localId;
    const color = t.hit
      ? (isMe ? `rgba(255, 226, 120, ${alpha})` : `rgba(255, 130, 145, ${alpha})`)
      : (isMe ? `rgba(120, 190, 255, ${alpha})` : `rgba(255, 120, 160, ${alpha})`);

    ctx.strokeStyle = color;
    ctx.lineWidth = t.hit ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(t.startX, t.startY);
    ctx.lineTo(t.endX, t.endY);
    ctx.stroke();
  }
}

function render() {
  drawArena();
  drawTracers();
  for (const [id, p] of Object.entries(players)) {
    drawPlayer(id, p);
  }
  drawHudText();
  requestAnimationFrame(render);
}

render();
