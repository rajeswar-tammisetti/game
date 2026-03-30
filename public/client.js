const socket = io();

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const hostBtn = document.getElementById("hostBtn");
const joinBtn = document.getElementById("joinBtn");
const setLimitBtn = document.getElementById("setLimitBtn");
const restartBtn = document.getElementById("restartBtn");
const soundBtn = document.getElementById("soundBtn");
const setNameBtn = document.getElementById("setNameBtn");
const quickMatchBtn = document.getElementById("quickMatchBtn");
const cancelQuickBtn = document.getElementById("cancelQuickBtn");

const roomInput = document.getElementById("roomInput");
const scoreLimitInput = document.getElementById("scoreLimitInput");
const nameInput = document.getElementById("nameInput");

const roomLabel = document.getElementById("roomLabel");
const playersLabel = document.getElementById("playersLabel");
const onlineLabel = document.getElementById("onlineLabel");
const scoreMain = document.getElementById("scoreMain");
const scoreSub = document.getElementById("scoreSub");
const statusEl = document.getElementById("status");
const onlineListEl = document.getElementById("onlineList");
const feedEl = document.getElementById("feed");
const activityListEl = document.getElementById("activityList");

const restartPrompt = document.getElementById("restartPrompt");
const restartPromptText = document.getElementById("restartPromptText");
const restartAcceptBtn = document.getElementById("restartAcceptBtn");
const restartDeclineBtn = document.getElementById("restartDeclineBtn");

const mobileControls = document.getElementById("mobileControls");
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");
const fireBtn = document.getElementById("fireBtn");

const input = {
  up: false,
  down: false,
  left: false,
  right: false,
  aimX: 0,
  aimY: 0
};

let selfId = null;
let selfName = "";
let roomCode = null;
let scoreLimit = 5;
let roundsToWin = 2;
let roundNumber = 1;
let roundLive = false;
let roundCountdownUntil = 0;
let matchReady = false;
let matchOver = false;
let winnerId = null;
let quickSearching = false;
let soundEnabled = true;
let canShoot = true;
let lastShotAt = 0;
let restartPending = false;
let restartRequesterId = null;

let players = {};
let pickup = { active: false, type: null, x: 0, y: 0 };
let onlinePlayers = [];
let onlineCount = 0;
let queueCount = 0;

const tracers = [];
const burstFx = [];
const floatTexts = [];
const activityLogs = [];

const isTouchDevice =
  window.matchMedia("(hover: none), (pointer: coarse), (max-width: 900px)").matches ||
  ("ontouchstart" in window) ||
  (navigator.maxTouchPoints > 0);

const joystick = {
  active: false,
  pointerId: null,
  radius: 44
};

let fireHoldTimer = null;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioContextCtor) audioCtx = new AudioContextCtor();
  }
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
}

function playTone(freq, dur = 0.06, type = "square", gain = 0.02) {
  if (!soundEnabled) return;
  ensureAudio();
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(audioCtx.destination);
  const now = audioCtx.currentTime;
  osc.start(now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.stop(now + dur);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", !!isError);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function appendFeed(text) {
  const p = document.createElement("p");
  p.textContent = text;
  feedEl.prepend(p);
  while (feedEl.children.length > 8) feedEl.removeChild(feedEl.lastChild);
}

function renderActivityLogs() {
  activityListEl.innerHTML = "";
  for (const log of activityLogs.slice(0, 30)) {
    const p = document.createElement("p");
    p.innerHTML = `<span class="time">${log.timeText || ""}</span><span class="name">${log.name || "System"}</span>${log.action || ""}`;
    activityListEl.appendChild(p);
  }
}

function addActivityLog(log) {
  activityLogs.unshift(log);
  if (activityLogs.length > 60) activityLogs.pop();
  renderActivityLogs();
}

function updateScore() {
  if (!selfId || !players[selfId]) {
    scoreMain.textContent = "Me 0 - 0 Enemy";
    scoreSub.textContent = `Round 1 | First to ${scoreLimit}`;
    return;
  }

  const me = players[selfId];
  const enemyEntry = Object.entries(players).find(([id]) => id !== selfId);
  const enemy = enemyEntry ? enemyEntry[1] : null;
  const myKills = me.kills || 0;
  const enemyKills = enemy ? enemy.kills || 0 : 0;

  scoreMain.textContent = `Me ${myKills} - ${enemyKills} Enemy`;
  scoreSub.textContent = `Round ${roundNumber} | Bo3 (${me.roundWins || 0}-${enemy ? enemy.roundWins || 0 : 0}) | First to ${scoreLimit}`;
}

function renderLobby() {
  onlineLabel.textContent = `Online: ${onlineCount} | Searching: ${queueCount}`;
  onlineListEl.innerHTML = "";
  if (!onlinePlayers.length) {
    const empty = document.createElement("div");
    empty.className = "lobby-item";
    empty.textContent = "No idle players";
    onlineListEl.appendChild(empty);
    return;
  }

  for (const p of onlinePlayers) {
    const row = document.createElement("div");
    row.className = "lobby-item";
    const name = document.createElement("span");
    name.textContent = p.name;
    const btn = document.createElement("button");
    btn.className = "mini-btn secondary";
    btn.textContent = "Challenge";
    btn.onclick = () => socket.emit("send_challenge", { targetId: p.id });
    row.appendChild(name);
    row.appendChild(btn);
    onlineListEl.appendChild(row);
  }
}

function updateRestartPrompt() {
  const show = restartPending && restartRequesterId && restartRequesterId !== selfId;
  restartPrompt.style.display = show ? "block" : "none";
}

function sendInput() {
  if (!matchReady) return;
  socket.emit("player_input", input);
}

function setMoveFromJoystick(nx, ny) {
  input.left = nx < -0.25;
  input.right = nx > 0.25;
  input.up = ny < -0.25;
  input.down = ny > 0.25;
}

function updateAimFromClientPos(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const sx = (clientX - r.left) / r.width;
  const sy = (clientY - r.top) / r.height;
  input.aimX = clamp(sx * canvas.width, 0, canvas.width);
  input.aimY = clamp(sy * canvas.height, 0, canvas.height);
}

function resetJoystick() {
  joystick.active = false;
  joystick.pointerId = null;
  joystickKnob.style.transform = "translate(0px, 0px)";
  setMoveFromJoystick(0, 0);
}

function updateJoystick(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy) || 1;
  if (dist > joystick.radius) {
    dx = (dx / dist) * joystick.radius;
    dy = (dy / dist) * joystick.radius;
  }
  joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  setMoveFromJoystick(dx / joystick.radius, dy / joystick.radius);
}

function applyTouchAimAssist() {
  if (!isTouchDevice || !selfId || !players[selfId]) return;
  const me = players[selfId];
  let best = null;
  let bestDist = Infinity;
  for (const [id, p] of Object.entries(players)) {
    if (id === selfId || p.isDead) continue;
    const d = Math.hypot(input.aimX - p.x, input.aimY - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (best && bestDist < 110) {
    input.aimX = best.x;
    input.aimY = best.y;
  }
}

function tryShoot() {
  if (!matchReady || !roundLive || matchOver) return;
  if (selfId && players[selfId] && players[selfId].isShielded) return;
  if (!canShoot) return;

  applyTouchAimAssist();
  canShoot = false;
  lastShotAt = Date.now();
  socket.emit("shoot", { aimX: input.aimX, aimY: input.aimY });
  playTone(650, 0.05, "square", 0.03);
  setTimeout(() => { canShoot = true; }, 120);
}

hostBtn.onclick = () => {
  socket.emit("create_room");
  setStatus("Creating room...");
};

joinBtn.onclick = () => {
  const code = roomInput.value.trim().toUpperCase();
  if (!code) {
    setStatus("Enter room code first.", true);
    return;
  }
  socket.emit("join_room", { roomCode: code });
  setStatus(`Joining ${code}...`);
};

setLimitBtn.onclick = () => {
  const raw = Number(scoreLimitInput.value);
  const limit = Math.max(1, Math.min(50, Number.isFinite(raw) ? Math.floor(raw) : 5));
  scoreLimitInput.value = String(limit);
  socket.emit("set_score_limit", { limit });
};

restartBtn.onclick = () => socket.emit("request_restart");
restartAcceptBtn.onclick = () => socket.emit("respond_restart", { accept: true });
restartDeclineBtn.onclick = () => socket.emit("respond_restart", { accept: false });

setNameBtn.onclick = () => {
  const n = nameInput.value.trim();
  if (!n) return;
  socket.emit("set_name", { name: n });
};

quickMatchBtn.onclick = () => socket.emit("request_quick_match");
cancelQuickBtn.onclick = () => socket.emit("cancel_quick_match");

soundBtn.onclick = () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = `Sound: ${soundEnabled ? "On" : "Off"}`;
};

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w") input.up = true;
  if (k === "s") input.down = true;
  if (k === "a") input.left = true;
  if (k === "d") input.right = true;
  if (e.code === "Space") {
    e.preventDefault();
    tryShoot();
  }
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w") input.up = false;
  if (k === "s") input.down = false;
  if (k === "a") input.left = false;
  if (k === "d") input.right = false;
});

canvas.addEventListener("mousemove", (e) => updateAimFromClientPos(e.clientX, e.clientY));
canvas.addEventListener("mousedown", () => tryShoot());

if (!isTouchDevice) {
  mobileControls.style.display = "none";
} else {
  mobileControls.style.display = "flex";

  joystickBase.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    joystick.active = true;
    joystick.pointerId = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId);
    updateJoystick(e.clientX, e.clientY);
  });
  joystickBase.addEventListener("pointermove", (e) => {
    if (!joystick.active || e.pointerId !== joystick.pointerId) return;
    e.preventDefault();
    updateJoystick(e.clientX, e.clientY);
  });

  const endJoy = (e) => {
    if (!joystick.active || e.pointerId !== joystick.pointerId) return;
    e.preventDefault();
    resetJoystick();
  };
  joystickBase.addEventListener("pointerup", endJoy);
  joystickBase.addEventListener("pointercancel", endJoy);
  joystickBase.addEventListener("lostpointercapture", resetJoystick);

  const startFire = (e) => {
    e.preventDefault();
    tryShoot();
    if (fireHoldTimer) clearInterval(fireHoldTimer);
    fireHoldTimer = setInterval(tryShoot, 170);
  };
  const endFire = (e) => {
    e.preventDefault();
    if (!fireHoldTimer) return;
    clearInterval(fireHoldTimer);
    fireHoldTimer = null;
  };

  fireBtn.addEventListener("pointerdown", startFire);
  fireBtn.addEventListener("pointerup", endFire);
  fireBtn.addEventListener("pointercancel", endFire);
  fireBtn.addEventListener("pointerleave", endFire);

  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) updateAimFromClientPos(t.clientX, t.clientY);
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (t) updateAimFromClientPos(t.clientX, t.clientY);
  }, { passive: false });
}

socket.on("connect", () => setStatus("Connected. Create, join, or quick-start."));

socket.on("activity_log_init", ({ logs }) => {
  activityLogs.length = 0;
  for (const l of logs || []) activityLogs.push(l);
  renderActivityLogs();
});

socket.on("activity_log", (log) => {
  addActivityLog(log);
});

socket.on("profile", ({ id, name }) => {
  selfId = id;
  selfName = name;
  nameInput.value = name;
});

socket.on("lobby_snapshot", ({ onlineCount: oc, queueCount: qc, players: p }) => {
  onlineCount = oc || 0;
  queueCount = qc || 0;
  onlinePlayers = p || [];
  renderLobby();
});

socket.on("challenge_received", ({ fromId, fromName }) => {
  const accept = window.confirm(`${fromName} challenged you. Accept?`);
  socket.emit("respond_challenge", { fromId, accept });
});

socket.on("challenge_declined", ({ by }) => setStatus(`${by} declined challenge.`, true));
socket.on("challenge_error", ({ reason }) => setStatus(reason || "Challenge failed.", true));

socket.on("quick_match_searching", () => {
  quickSearching = true;
  setStatus("Searching active players...");
});
socket.on("quick_match_error", ({ reason }) => setStatus(reason || "Quick match failed.", true));

socket.on("match_created", ({ source }) => {
  quickSearching = false;
  setStatus(source === "challenge" ? "Challenge match started." : "Quick match found.");
});

socket.on("room_created", ({ roomCode: code }) => {
  roomCode = code;
  roomInput.value = code;
  roomLabel.textContent = `Room: ${code}`;
  setStatus("Room created. Share code to invite.");
});

socket.on("room_info", ({ roomCode: code, count, max }) => {
  roomCode = code;
  roomLabel.textContent = `Room: ${code}`;
  playersLabel.textContent = `Players: ${count}/${max}`;
});

socket.on("join_failed", ({ reason }) => setStatus(reason || "Failed to join.", true));

socket.on("match_ready", () => {
  matchReady = true;
  matchOver = false;
  winnerId = null;
  appendFeed("Match ready");
  setStatus("Match ready.");
});

socket.on("round_countdown", ({ roundNumber: rn, endsAt }) => {
  roundNumber = rn || roundNumber;
  roundCountdownUntil = endsAt || 0;
  roundLive = false;
  setStatus(`Round ${roundNumber} starting...`);
});

socket.on("round_started", ({ roundNumber: rn }) => {
  roundNumber = rn || roundNumber;
  roundLive = true;
  playTone(880, 0.12, "triangle", 0.05);
  appendFeed(`Round ${roundNumber} started`);
});

socket.on("round_over", ({ winnerId: wid }) => {
  roundLive = false;
  appendFeed(`${players[wid]?.name || "Player"} won round ${roundNumber}`);
});

socket.on("match_over", ({ winnerId: wid }) => {
  matchOver = true;
  winnerId = wid || null;
  setStatus(winnerId === selfId ? "You won the match." : "You lost the match.", winnerId !== selfId);
  playTone(winnerId === selfId ? 990 : 240, 0.2, "sine", 0.06);
});

socket.on("restart_requested", ({ requesterId }) => {
  restartPending = true;
  restartRequesterId = requesterId || null;
  updateRestartPrompt();
  if (requesterId === selfId) setStatus("Restart requested. Waiting...");
  else setStatus("Opponent requested restart.");
});

socket.on("restart_cancelled", ({ reason }) => {
  restartPending = false;
  restartRequesterId = null;
  updateRestartPrompt();
  setStatus(reason || "Restart cancelled.");
});

socket.on("restart_error", ({ reason }) => setStatus(reason || "Cannot restart now.", true));

socket.on("match_restarted", () => {
  matchReady = true;
  matchOver = false;
  winnerId = null;
  roundLive = false;
  restartPending = false;
  restartRequesterId = null;
  tracers.length = 0;
  burstFx.length = 0;
  floatTexts.length = 0;
  updateRestartPrompt();
  setStatus("Match restarted.");
});

socket.on("opponent_left", () => {
  matchReady = false;
  roundLive = false;
  setStatus("Opponent left room.", true);
});

socket.on("room_settings", ({ scoreLimit: limit }) => {
  if (!limit) return;
  scoreLimit = limit;
  scoreLimitInput.value = String(limit);
  updateScore();
});

socket.on("state", (snapshot) => {
  selfId = snapshot.you;
  players = snapshot.players || {};
  scoreLimit = snapshot.scoreLimit || scoreLimit;
  roundsToWin = snapshot.roundsToWin || roundsToWin;
  roundNumber = snapshot.roundNumber || roundNumber;
  roundLive = !!snapshot.roundLive;
  roundCountdownUntil = snapshot.roundCountdownUntil || 0;
  matchOver = !!snapshot.matchOver;
  winnerId = snapshot.winnerId || null;
  restartPending = !!snapshot.restartPending;
  restartRequesterId = snapshot.restartRequesterId || null;
  pickup = snapshot.pickup || pickup;
  scoreLimitInput.value = String(scoreLimit);
  updateScore();
  updateRestartPrompt();
});

socket.on("shot_fired", (shot) => {
  tracers.push({
    ...shot,
    expiresAt: Date.now() + 120
  });
  if (shot.hit) {
    burstFx.push({ x: shot.endX, y: shot.endY, expiresAt: Date.now() + 180 });
    floatTexts.push({
      x: shot.endX + (Math.random() * 18 - 9),
      y: shot.endY - 12,
      text: `-${shot.damage}`,
      color: "#ffd27f",
      expiresAt: Date.now() + 520
    });
    playTone(450, 0.04, "triangle", 0.03);
  }
});

socket.on("kill_feed", ({ killerId, victimId }) => {
  const killer = players[killerId]?.name || "Player";
  const victim = players[victimId]?.name || "Player";
  appendFeed(`${killer} eliminated ${victim}`);
});

socket.on("pickup_taken", ({ playerId, type }) => {
  const pName = players[playerId]?.name || "Player";
  appendFeed(`${pName} picked ${type}`);
  playTone(720, 0.08, "sine", 0.04);
});

setInterval(sendInput, 1000 / 30);

function drawArena(now) {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, "#111722");
  g.addColorStop(1, "#0a1018");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.strokeStyle = "rgba(55, 82, 112, 0.22)";
  const offset = (now / 40) % 40;
  for (let x = -40; x < canvas.width + 40; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x + offset, 0);
    ctx.lineTo(x + offset, canvas.height);
    ctx.stroke();
  }
  for (let y = -40; y < canvas.height + 40; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y + offset);
    ctx.lineTo(canvas.width, y + offset);
    ctx.stroke();
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, canvas.width * 0.1,
    canvas.width / 2, canvas.height / 2, canvas.width * 0.75
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawPickup(now) {
  if (!pickup || !pickup.active) return;
  const t = now / 220;
  const pulse = 8 + Math.sin(t) * 3;
  const colorByType = {
    speed: "#46c6ff",
    heal: "#2ce09f",
    multiplier: "#ffcb45",
    shield: "#b38cff"
  };
  const color = colorByType[pickup.type] || "#ffffff";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(pickup.x, pickup.y, pulse + 10, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(pickup.x, pickup.y, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#d9e8ff";
  ctx.font = "12px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(pickup.type.toUpperCase(), pickup.x, pickup.y - 18);
  ctx.textAlign = "start";
}

function drawPlayers(now) {
  for (const [id, p] of Object.entries(players)) {
    const isMe = id === selfId;
    const dead = p.isDead;
    const c = isMe ? "#58a0ff" : "#ff647f";

    if (!dead) {
      const dx = p.aimX - p.x;
      const dy = p.aimY - p.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = isMe ? "rgba(114,176,255,.8)" : "rgba(255,137,156,.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (dx / len) * 32, p.y + (dy / len) * 32);
      ctx.stroke();
    }

    if (p.isShielded) {
      ctx.strokeStyle = "rgba(136,255,225,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 22 + Math.sin(now / 110) * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = dead ? "#555a62" : c;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.fill();

    const hpRatio = clamp((p.hp || 0) / 100, 0, 1);
    ctx.fillStyle = "#2d3645";
    ctx.fillRect(p.x - 20, p.y - 29, 40, 5);
    ctx.fillStyle = hpRatio > 0.35 ? "#2cc8a3" : "#e45858";
    ctx.fillRect(p.x - 20, p.y - 29, 40 * hpRatio, 5);

    ctx.fillStyle = "#d5e5ff";
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(p.name || "Player", p.x, p.y + 28);
    ctx.textAlign = "start";
  }
}

function drawTracers(now) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    if (t.expiresAt <= now) {
      tracers.splice(i, 1);
      continue;
    }
    const a = (t.expiresAt - now) / 120;
    const isMe = t.shooterId === selfId;
    const color = t.hit
      ? (isMe ? `rgba(255,226,120,${a})` : `rgba(255,130,145,${a})`)
      : (isMe ? `rgba(120,190,255,${a})` : `rgba(255,120,160,${a})`);
    ctx.strokeStyle = color;
    ctx.lineWidth = t.hit ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(t.startX, t.startY);
    ctx.lineTo(t.endX, t.endY);
    ctx.stroke();
  }
}

function drawBurst(now) {
  for (let i = burstFx.length - 1; i >= 0; i--) {
    const b = burstFx[i];
    if (b.expiresAt <= now) {
      burstFx.splice(i, 1);
      continue;
    }
    const t = 1 - (b.expiresAt - now) / 180;
    const r = 6 + t * 16;
    ctx.strokeStyle = `rgba(255,220,140,${1 - t})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawFloatTexts(now) {
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i];
    if (f.expiresAt <= now) {
      floatTexts.splice(i, 1);
      continue;
    }
    const t = 1 - (f.expiresAt - now) / 520;
    ctx.fillStyle = `rgba(255,220,140,${1 - t})`;
    ctx.font = "bold 16px Segoe UI";
    ctx.fillText(f.text, f.x, f.y - t * 18);
  }
}

function drawMiniMap() {
  const w = 160;
  const h = 96;
  const x = canvas.width - w - 12;
  const y = 12;

  ctx.fillStyle = "rgba(12,20,30,0.72)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(110,140,170,0.7)";
  ctx.strokeRect(x, y, w, h);

  for (const [id, p] of Object.entries(players)) {
    const px = x + (p.x / canvas.width) * w;
    const py = y + (p.y / canvas.height) * h;
    ctx.fillStyle = id === selfId ? "#6ab1ff" : "#ff7e92";
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHud(now) {
  if (!selfId || !players[selfId]) return;
  const me = players[selfId];

  ctx.fillStyle = "#e8edf5";
  ctx.font = "16px Segoe UI";
  ctx.fillText(`HP: ${me.hp}`, 12, 24);
  if (me.isShielded) ctx.fillText("SPAWN SHIELD", 12, 46);
  if (me.hasSpeedBoost) ctx.fillText("SPEED BOOST", 12, me.isShielded ? 68 : 46);
  if (me.hasMultiplier) ctx.fillText(`DMG x${me.multiplierValue.toFixed(2)}`, 12, me.isShielded || me.hasSpeedBoost ? 90 : 68);

  if (Date.now() - lastShotAt < 120) {
    ctx.fillStyle = "#ffd166";
    ctx.fillText("SHOT", 12, 112);
  }

  if (!roundLive && roundCountdownUntil > Date.now() && !matchOver) {
    const sec = Math.max(1, Math.ceil((roundCountdownUntil - Date.now()) / 1000));
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 54px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(String(sec), canvas.width / 2, canvas.height / 2);
    ctx.font = "18px Segoe UI";
    ctx.fillText(`Round ${roundNumber}`, canvas.width / 2, canvas.height / 2 + 32);
    ctx.textAlign = "start";
  }

  if (matchOver) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 46px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(winnerId === selfId ? "VICTORY" : "DEFEAT", canvas.width / 2, canvas.height / 2);
    ctx.font = "18px Segoe UI";
    ctx.fillText(`First to ${roundsToWin} rounds`, canvas.width / 2, canvas.height / 2 + 34);
    ctx.textAlign = "start";
  }
}

function render(now = performance.now()) {
  drawArena(now);
  drawPickup(now);
  drawTracers(now);
  drawPlayers(now);
  drawBurst(now);
  drawFloatTexts(now);
  drawMiniMap();
  drawHud(now);
  requestAnimationFrame(render);
}

render();
