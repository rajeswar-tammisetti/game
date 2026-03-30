const socket = io();

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const hostBtn = document.getElementById("hostBtn");
const joinBtn = document.getElementById("joinBtn");
const homeStartBtn = document.getElementById("homeStartBtn");
const mode1v1Btn = document.getElementById("mode1v1Btn");
const mode2v2Btn = document.getElementById("mode2v2Btn");
const modeRoomBtn = document.getElementById("modeRoomBtn");
const modeSettingsBtn = document.getElementById("modeSettingsBtn");
const setLimitBtn = document.getElementById("setLimitBtn");
const restartBtn = document.getElementById("restartBtn");
const continueBtn = document.getElementById("continueBtn");
const restartMatchBtn = document.getElementById("restartMatchBtn");
const quitBtn = document.getElementById("quitBtn");
const soundBtn = document.getElementById("soundBtn");
const toggleControlsBtn = document.getElementById("toggleControlsBtn");
const setNameBtn = document.getElementById("setNameBtn");
const quickMatchBtn = document.getElementById("quickMatchBtn");
const cancelQuickBtn = document.getElementById("cancelQuickBtn");
const leftSideBtn = document.getElementById("leftSideBtn");
const rightSideBtn = document.getElementById("rightSideBtn");
const playerColorInput = document.getElementById("playerColorInput");

const roomInput = document.getElementById("roomInput");
const scoreLimitInput = document.getElementById("scoreLimitInput");
const nameInput = document.getElementById("nameInput");

const roomLabel = document.getElementById("roomLabel");
const playersLabel = document.getElementById("playersLabel");
const sidesLabel = document.getElementById("sidesLabel");
const onlineLabel = document.getElementById("onlineLabel");
const scoreMain = document.getElementById("scoreMain");
const scoreSub = document.getElementById("scoreSub");
const statusEl = document.getElementById("status");
const chatTitleEl = document.getElementById("chatTitle");
const onlineListEl = document.getElementById("onlineList");
const feedEl = document.getElementById("feed");
const chatListEl = document.getElementById("chatList");
const chatInput = document.getElementById("chatInput");
const chatSendBtn = document.getElementById("chatSendBtn");
const topLeftNameEl = document.getElementById("topLeftName");
const topRightNameEl = document.getElementById("topRightName");
const topTimeEl = document.getElementById("topTime");
const topScoreEl = document.getElementById("topScore");

const restartPrompt = document.getElementById("restartPrompt");
const restartPromptText = document.getElementById("restartPromptText");
const restartAcceptBtn = document.getElementById("restartAcceptBtn");
const restartDeclineBtn = document.getElementById("restartDeclineBtn");
const challengePrompt = document.getElementById("challengePrompt");
const challengePromptText = document.getElementById("challengePromptText");
const challengeAcceptBtn = document.getElementById("challengeAcceptBtn");
const challengeDeclineBtn = document.getElementById("challengeDeclineBtn");

const mobileControls = document.getElementById("mobileControls");
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");
const fireBtn = document.getElementById("fireBtn");
const reloadBtn = document.getElementById("reloadBtn");

const CLIP_SIZE = 8;

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
let lastShotAt = 0;
let restartPending = false;
let restartRequesterId = null;
let pendingChallengeFromId = null;
let controlsForcedVisible = false;
let preferredSide = "left";
let myColor = "#58a0ff";
let roomSides = { left: null, right: null };
let selectedMode = "1v1";
let matchStartedAt = 0;

let players = {};
let pickup = { active: false, type: null, x: 0, y: 0 };
let onlinePlayers = [];
let onlineCount = 0;
let queueCount = 0;

const tracers = [];
const burstFx = [];
const floatTexts = [];
const muzzleFx = [];
const chatMessages = [];
const recentShotUntil = {};

const isTouchDevice =
  window.matchMedia("(hover: none) and (pointer: coarse)").matches ||
  (navigator.maxTouchPoints > 0);

const joystick = {
  active: false,
  pointerId: null,
  radius: 44
};

let fireHoldTimer = null;
let audioCtx = null;
let mouseFireHeld = false;
const gridHover = {
  active: false,
  x: canvas.width * 0.5,
  y: canvas.height * 0.5,
  lastMoveAt: 0
};

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

function idPhase(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h % 1000) / 1000;
}

function appendFeed(text) {
  const p = document.createElement("p");
  p.textContent = text;
  feedEl.prepend(p);
  while (feedEl.children.length > 8) feedEl.removeChild(feedEl.lastChild);
}

function renderChatMessages() {
  updateChatModeLabel();
  chatListEl.innerHTML = "";
  if (chatMessages.length === 0) {
    chatListEl.classList.add("empty");
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "No messages yet";
    chatListEl.appendChild(empty);
    chatListEl.scrollTop = 0;
    return;
  }
  chatListEl.classList.remove("empty");
  for (const msg of chatMessages.slice(-40)) {
    const p = document.createElement("p");
    const time = document.createElement("span");
    time.className = "time";
    time.textContent = msg.timeText || "--:--:--";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = msg.name || "Player";

    const text = document.createElement("span");
    text.textContent = msg.text || "";

    p.appendChild(time);
    p.appendChild(name);
    p.appendChild(text);
    chatListEl.appendChild(p);
  }
  chatListEl.scrollTop = chatListEl.scrollHeight;
}

function addChatMessage(msg) {
  chatMessages.push(msg);
  if (chatMessages.length > 80) chatMessages.shift();
  renderChatMessages();
}

function hasCustomName() {
  return !!selfName && selfName.trim().length >= 2;
}

function requireNameBeforePlay() {
  if (hasCustomName()) return true;
  setStatus("Set your name first (minimum 2 characters).", true);
  nameInput.focus();
  return false;
}

function sendChat() {
  if (!hasCustomName()) {
    setStatus("Set your name first to chat.", true);
    nameInput.focus();
    return;
  }
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat_send", { text });
  chatInput.value = "";
}

function requestRestart() {
  if (!roomCode) {
    setStatus("Join a room first.", true);
    return;
  }
  setStatus("Restart requested. Waiting for opponent...");
  socket.emit("request_restart");
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
    btn.onclick = () => {
      if (!requireNameBeforePlay()) return;
      socket.emit("send_challenge", { targetId: p.id });
    };
    row.appendChild(name);
    row.appendChild(btn);
    onlineListEl.appendChild(row);
  }
}

function updateRestartPrompt() {
  const show = restartPending && restartRequesterId && restartRequesterId !== selfId;
  restartPrompt.style.display = show ? "block" : "none";
}

function updateSideButtons() {
  if (leftSideBtn) leftSideBtn.classList.toggle("active-side", preferredSide === "left");
  if (rightSideBtn) rightSideBtn.classList.toggle("active-side", preferredSide === "right");
}

function updateModeButtons() {
  mode1v1Btn.classList.toggle("active-mode", selectedMode === "1v1");
  mode2v2Btn.classList.toggle("active-mode", selectedMode === "2v2");
  modeRoomBtn.classList.toggle("active-mode", selectedMode === "room");
  modeSettingsBtn.classList.toggle("active-mode", selectedMode === "settings");
}

function updateMatchTopbar() {
  const leftId = roomSides.left?.id || Object.keys(players).find((id) => players[id]?.side === "left");
  const rightId = roomSides.right?.id || Object.keys(players).find((id) => players[id]?.side === "right");
  const leftName = leftId ? (players[leftId]?.name || roomSides.left?.name || "Player 1") : "Player 1";
  const rightName = rightId ? (players[rightId]?.name || roomSides.right?.name || "Player 2") : "Player 2";
  const leftScore = leftId ? (players[leftId]?.kills || 0) : 0;
  const rightScore = rightId ? (players[rightId]?.kills || 0) : 0;

  topLeftNameEl.textContent = leftName;
  topRightNameEl.textContent = rightName;
  topScoreEl.textContent = `${leftScore} - ${rightScore}`;

  if (!matchStartedAt || !matchReady) {
    topTimeEl.textContent = "00:00";
    return;
  }
  const sec = Math.max(0, Math.floor((Date.now() - matchStartedAt) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  topTimeEl.textContent = `${mm}:${ss}`;
}

function applyControlsVisibility() {
  const show = controlsForcedVisible || isTouchDevice;
  mobileControls.style.display = show ? "flex" : "none";
  toggleControlsBtn.textContent = controlsForcedVisible ? "🕹 ON" : "🕹 AUTO";
  toggleControlsBtn.classList.toggle("toggle-on", controlsForcedVisible);
  toggleControlsBtn.classList.toggle("toggle-off", !controlsForcedVisible);
}

function setInMatchUI(inMatch) {
  document.body.classList.toggle("in-match", !!inMatch);
}

function setMatchOverUI(isOver) {
  document.body.classList.toggle("match-over", !!isOver);
}

function updateChatModeLabel() {
  if (!chatTitleEl) return;
  chatTitleEl.textContent = roomCode ? "Room Chat" : "Global Chat";
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

function updateGridHoverFromClientPos(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const sx = (clientX - r.left) / r.width;
  const sy = (clientY - r.top) / r.height;
  gridHover.x = clamp(sx * canvas.width, 0, canvas.width);
  gridHover.y = clamp(sy * canvas.height, 0, canvas.height);
  gridHover.active = true;
  gridHover.lastMoveAt = Date.now();
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

function tryReload() {
  if (!matchReady || !roundLive || matchOver || !selfId || !players[selfId]) return;
  const me = players[selfId];
  if (me.isDead || me.isReloading) return;
  if ((me.ammo || 0) >= CLIP_SIZE) return;
  socket.emit("reload");
  playTone(300, 0.07, "sawtooth", 0.025);
}

function tryShoot() {
  if (!matchReady || !roundLive || matchOver) return;
  if (selfId && players[selfId]) {
    const me = players[selfId];
    if (me.isShielded) return;
    if (me.isDead || me.isReloading) return;
    if ((me.ammo || 0) <= 0) {
      tryReload();
      return;
    }
  }

  applyTouchAimAssist();
  lastShotAt = Date.now();
  socket.emit("shoot", { aimX: input.aimX, aimY: input.aimY });
  playTone(650, 0.05, "square", 0.03);
}

hostBtn.onclick = () => {
  if (!requireNameBeforePlay()) return;
  socket.emit("create_room", { preferredSide });
  setStatus("Creating room...");
};

joinBtn.onclick = () => {
  if (!requireNameBeforePlay()) return;
  const code = roomInput.value.trim().toUpperCase();
  if (!code) {
    setStatus("Enter room code first.", true);
    return;
  }
  socket.emit("join_room", { roomCode: code, preferredSide });
  setStatus(`Joining ${code}...`);
};

setLimitBtn.onclick = () => {
  const raw = Number(scoreLimitInput.value);
  const limit = Math.max(1, Math.min(50, Number.isFinite(raw) ? Math.floor(raw) : 5));
  scoreLimitInput.value = String(limit);
  socket.emit("set_score_limit", { limit });
};

restartBtn.onclick = requestRestart;
continueBtn.onclick = () => socket.emit("leave_room");
restartMatchBtn.onclick = requestRestart;
quitBtn.onclick = () => socket.emit("leave_room");
restartAcceptBtn.onclick = () => socket.emit("respond_restart", { accept: true });
restartDeclineBtn.onclick = () => socket.emit("respond_restart", { accept: false });
challengeAcceptBtn.onclick = () => {
  if (!pendingChallengeFromId) return;
  socket.emit("respond_challenge", { fromId: pendingChallengeFromId, accept: true });
  pendingChallengeFromId = null;
  challengePrompt.style.display = "none";
};
challengeDeclineBtn.onclick = () => {
  if (!pendingChallengeFromId) return;
  socket.emit("respond_challenge", { fromId: pendingChallengeFromId, accept: false });
  pendingChallengeFromId = null;
  challengePrompt.style.display = "none";
};

setNameBtn.onclick = () => {
  const n = nameInput.value.trim();
  if (n.length < 2) {
    setStatus("Name must be at least 2 characters.", true);
    return;
  }
  socket.emit("set_name", { name: n });
};

quickMatchBtn.onclick = () => {
  if (!requireNameBeforePlay()) return;
  socket.emit("request_quick_match");
};
cancelQuickBtn.onclick = () => socket.emit("cancel_quick_match");
homeStartBtn.onclick = () => {
  if (!requireNameBeforePlay()) return;
  if (selectedMode === "2v2") {
    setStatus("2v2 is coming soon. Use 1v1 or Room mode for now.", true);
    return;
  }
  if (selectedMode === "room") {
    socket.emit("create_room", { preferredSide });
    setStatus("Creating room...");
    return;
  }
  if (selectedMode === "settings") {
    setStatus("Settings mode selected. Configure options below.", false);
    return;
  }
  socket.emit("request_quick_match");
};
mode1v1Btn.onclick = () => {
  selectedMode = "1v1";
  updateModeButtons();
  setStatus("Mode: 1v1 quick match.");
};
mode2v2Btn.onclick = () => {
  selectedMode = "2v2";
  updateModeButtons();
  setStatus("2v2 mode is not available yet.", true);
};
modeRoomBtn.onclick = () => {
  selectedMode = "room";
  updateModeButtons();
  setStatus("Mode: Room match (create/join by code).");
};
modeSettingsBtn.onclick = () => {
  selectedMode = "settings";
  updateModeButtons();
  setStatus("Settings mode. Adjust sound/controls/side/color.");
};
if (leftSideBtn) {
  leftSideBtn.onclick = () => {
    preferredSide = "left";
    updateSideButtons();
    if (roomCode) socket.emit("choose_side", { side: preferredSide });
  };
}
if (rightSideBtn) {
  rightSideBtn.onclick = () => {
    preferredSide = "right";
    updateSideButtons();
    if (roomCode) socket.emit("choose_side", { side: preferredSide });
  };
}
if (playerColorInput) {
  playerColorInput.addEventListener("input", () => {
    myColor = playerColorInput.value || "#58a0ff";
  });
}
chatSendBtn.onclick = sendChat;
chatInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  sendChat();
});

soundBtn.onclick = () => {
  soundEnabled = !soundEnabled;
  soundBtn.textContent = `Sound: ${soundEnabled ? "On" : "Off"}`;
};

toggleControlsBtn.onclick = () => {
  controlsForcedVisible = !controlsForcedVisible;
  applyControlsVisibility();
};

window.addEventListener("keydown", (e) => {
  const el = e.target;
  const typing =
    el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable);
  if (typing) return;

  const k = e.key.toLowerCase();
  if (k === "w" || k === "arrowup") input.up = true;
  if (k === "s" || k === "arrowdown") input.down = true;
  if (k === "a" || k === "arrowleft") input.left = true;
  if (k === "d" || k === "arrowright") input.right = true;
  if (e.code === "Space") {
    e.preventDefault();
    tryShoot();
  }
  if (k === "r") {
    e.preventDefault();
    tryReload();
  }
});

window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (k === "w" || k === "arrowup") input.up = false;
  if (k === "s" || k === "arrowdown") input.down = false;
  if (k === "a" || k === "arrowleft") input.left = false;
  if (k === "d" || k === "arrowright") input.right = false;
});

canvas.addEventListener("mousemove", (e) => {
  updateAimFromClientPos(e.clientX, e.clientY);
  updateGridHoverFromClientPos(e.clientX, e.clientY);
});
window.addEventListener("mousemove", (e) => updateAimFromClientPos(e.clientX, e.clientY));
canvas.addEventListener("mouseenter", () => {
  gridHover.active = true;
  gridHover.lastMoveAt = Date.now();
});
canvas.addEventListener("mouseleave", () => {
  gridHover.active = false;
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  mouseFireHeld = true;
  tryShoot();
  if (fireHoldTimer) clearInterval(fireHoldTimer);
  fireHoldTimer = setInterval(() => {
    if (!mouseFireHeld) return;
    tryShoot();
  }, 170);
});

window.addEventListener("mouseup", () => {
  mouseFireHeld = false;
  if (!fireHoldTimer) return;
  clearInterval(fireHoldTimer);
  fireHoldTimer = null;
});

applyControlsVisibility();
updateSideButtons();
updateModeButtons();

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
fireBtn.addEventListener("touchstart", startFire, { passive: false });
fireBtn.addEventListener("touchend", endFire, { passive: false });
fireBtn.addEventListener("touchcancel", endFire, { passive: false });
const pressReload = (e) => {
  e.preventDefault();
  tryReload();
};
reloadBtn.addEventListener("pointerdown", pressReload);
reloadBtn.addEventListener("touchstart", pressReload, { passive: false });

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

socket.on("connect", () => {
  setStatus("Connected. Create, join, or quick-start.");
  setMatchOverUI(false);
  matchStartedAt = 0;
  updateChatModeLabel();
  updateMatchTopbar();
  socket.emit("request_chat_init");
  socket.emit("request_lobby_snapshot");
});

socket.on("chat_init", ({ messages }) => {
  chatMessages.length = 0;
  for (const m of messages || []) chatMessages.push(m);
  renderChatMessages();
});

socket.on("chat_message", (msg) => {
  addChatMessage(msg);
});

socket.on("chat_error", ({ reason }) => {
  setStatus(reason || "Chat failed.", true);
});

socket.on("profile", ({ id, name }) => {
  selfId = id;
  selfName = name || "";
  nameInput.value = selfName;
  if (!hasCustomName()) {
    setStatus("Enter your name (min 2 chars) to start playing.");
  }
});

socket.on("lobby_snapshot", ({ onlineCount: oc, queueCount: qc, players: p }) => {
  onlineCount = oc || 0;
  queueCount = qc || 0;
  onlinePlayers = p || [];
  renderLobby();
});

socket.on("challenge_received", ({ fromId, fromName }) => {
  pendingChallengeFromId = fromId;
  challengePromptText.textContent = `${fromName} challenged you. Accept?`;
  challengePrompt.style.display = "block";
  setStatus("Challenge received.");
});

socket.on("challenge_declined", ({ by }) => {
  setStatus(`${by} declined challenge.`, true);
  challengePrompt.style.display = "none";
  pendingChallengeFromId = null;
});
socket.on("challenge_error", ({ reason }) => setStatus(reason || "Challenge failed.", true));

socket.on("quick_match_searching", () => {
  quickSearching = true;
  setStatus("Searching active players...");
});
socket.on("quick_match_error", ({ reason }) => setStatus(reason || "Quick match failed.", true));

socket.on("match_created", ({ source, roomCode: code }) => {
  quickSearching = false;
  setMatchOverUI(false);
  challengePrompt.style.display = "none";
  pendingChallengeFromId = null;
  if (code) {
    roomCode = code;
    roomLabel.textContent = `Room: ${code}`;
    updateChatModeLabel();
    socket.emit("request_chat_init");
  }
  setStatus(source === "challenge" ? "Challenge match started." : "Quick match found.");
});

socket.on("room_created", ({ roomCode: code }) => {
  roomCode = code;
  roomInput.value = code;
  roomLabel.textContent = `Room: ${code}`;
  updateChatModeLabel();
  socket.emit("request_chat_init");
  setStatus("Room created. Share code to invite.");
});

socket.on("room_info", ({ roomCode: code, count, max, sides }) => {
  roomCode = code;
  roomLabel.textContent = `Room: ${code}`;
  playersLabel.textContent = `Players: ${count}/${max}`;
  roomSides = sides || roomSides;
  const leftName = roomSides.left?.name || "-";
  const rightName = roomSides.right?.name || "-";
  sidesLabel.textContent = `Sides: Left ${leftName} | Right ${rightName}`;
  updateChatModeLabel();
  updateMatchTopbar();
});

socket.on("join_failed", ({ reason }) => setStatus(reason || "Failed to join.", true));

socket.on("match_ready", () => {
  matchReady = true;
  matchOver = false;
  matchStartedAt = Date.now();
  setMatchOverUI(false);
  winnerId = null;
  challengePrompt.style.display = "none";
  pendingChallengeFromId = null;
  setInMatchUI(true);
  updateMatchTopbar();
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
  setMatchOverUI(true);
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
  matchStartedAt = Date.now();
  setMatchOverUI(false);
  winnerId = null;
  roundLive = false;
  restartPending = false;
  restartRequesterId = null;
  tracers.length = 0;
  burstFx.length = 0;
  floatTexts.length = 0;
  muzzleFx.length = 0;
  setInMatchUI(true);
  updateMatchTopbar();
  updateRestartPrompt();
  setStatus("Match restarted.");
});

socket.on("opponent_left", () => {
  matchReady = false;
  matchStartedAt = 0;
  roundLive = false;
  setMatchOverUI(false);
  challengePrompt.style.display = "none";
  pendingChallengeFromId = null;
  roomCode = null;
  roomSides = { left: null, right: null };
  sidesLabel.textContent = "Sides: Left - | Right -";
  updateChatModeLabel();
  socket.emit("request_chat_init");
  setInMatchUI(false);
  updateMatchTopbar();
  setStatus("Opponent left room.", true);
});

socket.on("room_closed", ({ reason }) => {
  matchReady = false;
  matchStartedAt = 0;
  roundLive = false;
  matchOver = false;
  setMatchOverUI(false);
  winnerId = null;
  roomCode = null;
  roomSides = { left: null, right: null };
  sidesLabel.textContent = "Sides: Left - | Right -";
  updateChatModeLabel();
  socket.emit("request_chat_init");
  roomLabel.textContent = "Room: -";
  playersLabel.textContent = "Players: 0/2";
  setInMatchUI(false);
  updateMatchTopbar();
  setStatus(reason || "Room closed.");
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
  setMatchOverUI(matchOver);
  winnerId = snapshot.winnerId || null;
  restartPending = !!snapshot.restartPending;
  restartRequesterId = snapshot.restartRequesterId || null;
  pickup = snapshot.pickup || pickup;
  scoreLimitInput.value = String(scoreLimit);
  updateScore();
  updateMatchTopbar();
  updateRestartPrompt();
});

socket.on("shot_fired", (shot) => {
  const dx = shot.endX - shot.startX;
  const dy = shot.endY - shot.startY;
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;

  recentShotUntil[shot.shooterId] = Date.now() + 120;
  muzzleFx.push({
    x: shot.startX + dirX * 26,
    y: shot.startY + dirY * 26,
    angle: Math.atan2(dirY, dirX),
    hit: !!shot.hit,
    expiresAt: Date.now() + 90
  });

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
  const spacing = 40;
  const offset = (now / 40) % spacing;
  for (let x = -spacing; x < canvas.width + spacing; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x + offset, 0);
    ctx.lineTo(x + offset, canvas.height);
    ctx.stroke();
  }
  for (let y = -spacing; y < canvas.height + spacing; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y + offset);
    ctx.lineTo(canvas.width, y + offset);
    ctx.stroke();
  }
  ctx.restore();

  const hoverAgeMs = Date.now() - gridHover.lastMoveAt;
  const hoverAlpha = gridHover.active ? 1 : clamp(1 - hoverAgeMs / 300, 0, 1);
  if (hoverAlpha > 0.01) {
    const glow = ctx.createRadialGradient(
      gridHover.x,
      gridHover.y,
      12,
      gridHover.x,
      gridHover.y,
      150
    );
    glow.addColorStop(0, `rgba(120, 205, 255, ${0.24 * hoverAlpha})`);
    glow.addColorStop(0.45, `rgba(95, 185, 255, ${0.12 * hoverAlpha})`);
    glow.addColorStop(1, "rgba(95, 185, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

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
    heal: "#39ffb8",
    multiplier: "#ffcb45",
    shield: "#b38cff",
    triple: "#ff9f57"
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
  const mySide = selfId && players[selfId] ? players[selfId].side : null;
  for (const [id, p] of Object.entries(players)) {
    const isMe = id === selfId;
    const dead = p.isDead;
    const isFriendly = mySide && p.side === mySide;
    const c = isMe ? myColor : (isFriendly ? "#39ffb8" : "#ff647f");
    const phase = idPhase(id);
    const bob = dead ? 0 : Math.sin(now / 210 + phase * Math.PI * 2) * 1.6;

    if (!dead) {
      const dx = p.aimX - p.x;
      const dy = p.aimY - p.y;
      const len = Math.hypot(dx, dy) || 1;
      const dirX = dx / len;
      const dirY = dy / len;
      const angle = Math.atan2(dirY, dirX);
      const recoil = (recentShotUntil[id] || 0) > Date.now() ? 4 : 0;

      // Gun body with tiny recoil animation.
      ctx.save();
      ctx.translate(p.x + bob, p.y + bob);
      ctx.rotate(angle);
      const gunBaseColor = isMe ? myColor : (isFriendly ? "#bfffe8" : "#ffd1da");
      const gunGlow = isMe
        ? "rgba(88,180,255,0.55)"
        : (isFriendly ? "rgba(74,255,194,0.52)" : "rgba(255,148,170,0.55)");
      ctx.shadowColor = gunGlow;
      ctx.shadowBlur = 8;
      ctx.fillStyle = gunBaseColor;
      ctx.fillRect(6 - recoil, -4, 24, 8);
      ctx.fillStyle = "#2a2f39";
      ctx.fillRect(20 - recoil, -2, 14, 4);
      ctx.restore();

      ctx.strokeStyle = isMe
        ? "rgba(114,176,255,.8)"
        : (isFriendly ? "rgba(90,255,200,.8)" : "rgba(255,137,156,.8)");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x + bob, p.y + bob);
      ctx.lineTo(p.x + bob + dirX * 34, p.y + bob + dirY * 34);
      ctx.stroke();
    }

    if (p.isShielded) {
      ctx.strokeStyle = "rgba(136,255,225,0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x + bob, p.y + bob, 22 + Math.sin(now / 110) * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }

    const bodyX = p.x + bob;
    const bodyY = p.y + bob;
    const bodyGrad = ctx.createRadialGradient(bodyX - 6, bodyY - 8, 2, bodyX, bodyY, 24);
    bodyGrad.addColorStop(0, dead ? "#7b818a" : isMe ? "#89baff" : (isFriendly ? "#9dffd8" : "#ffa4b5"));
    bodyGrad.addColorStop(1, dead ? "#4c535d" : c);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(bodyX, bodyY, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(20,28,40,0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(bodyX, bodyY, 16, 0, Math.PI * 2);
    ctx.stroke();

    // Simple texture stripes.
    ctx.save();
    ctx.beginPath();
    ctx.arc(bodyX, bodyY, 15.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bodyX - 14, bodyY - 5);
    ctx.lineTo(bodyX + 14, bodyY - 11);
    ctx.moveTo(bodyX - 14, bodyY + 3);
    ctx.lineTo(bodyX + 14, bodyY - 3);
    ctx.stroke();
    ctx.restore();

    const hpRatio = clamp((p.hp || 0) / 100, 0, 1);
    ctx.fillStyle = "#2d3645";
    ctx.fillRect(bodyX - 20, bodyY - 29, 40, 5);
    ctx.fillStyle = hpRatio > 0.35 ? "#39ffb8" : "#e45858";
    ctx.fillRect(bodyX - 20, bodyY - 29, 40 * hpRatio, 5);

    ctx.fillStyle = "#d5e5ff";
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(p.name || "Player", bodyX, bodyY + 28);
    ctx.textAlign = "start";
  }
}

function drawTracers(nowMs) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    if (t.expiresAt <= nowMs) {
      tracers.splice(i, 1);
      continue;
    }
    const a = (t.expiresAt - nowMs) / 120;
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

function drawBurst(nowMs) {
  for (let i = burstFx.length - 1; i >= 0; i--) {
    const b = burstFx[i];
    if (b.expiresAt <= nowMs) {
      burstFx.splice(i, 1);
      continue;
    }
    const t = 1 - (b.expiresAt - nowMs) / 180;
    const r = 6 + t * 16;
    ctx.strokeStyle = `rgba(255,220,140,${1 - t})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawFloatTexts(nowMs) {
  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i];
    if (f.expiresAt <= nowMs) {
      floatTexts.splice(i, 1);
      continue;
    }
    const t = 1 - (f.expiresAt - nowMs) / 520;
    ctx.fillStyle = `rgba(255,220,140,${1 - t})`;
    ctx.font = "bold 16px Segoe UI";
    ctx.fillText(f.text, f.x, f.y - t * 18);
  }
}

function drawMuzzle(nowMs) {
  for (let i = muzzleFx.length - 1; i >= 0; i--) {
    const m = muzzleFx[i];
    if (m.expiresAt <= nowMs) {
      muzzleFx.splice(i, 1);
      continue;
    }
    const t = (m.expiresAt - nowMs) / 90;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    ctx.globalAlpha = t;
    ctx.fillStyle = m.hit ? "#ffe18a" : "#ffd3a1";
    ctx.shadowColor = "#ffd36a";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(18 + 8 * t, -5 - 2 * t);
    ctx.lineTo(18 + 8 * t, 5 + 2 * t);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawHud(now) {
  if (!selfId || !players[selfId]) return;
  const me = players[selfId];

  ctx.fillStyle = "#e8edf5";
  ctx.font = "16px Segoe UI";
  ctx.fillText(`HP: ${me.hp}`, 12, 24);
  ctx.fillText(`AMMO: ${me.ammo ?? CLIP_SIZE}/${CLIP_SIZE}`, 12, 46);
  let effectY = 68;
  if (me.isShielded) {
    ctx.fillText("SPAWN SHIELD", 12, effectY);
    effectY += 22;
  }
  if (me.hasSpeedBoost) {
    ctx.fillText("SPEED BOOST", 12, effectY);
    effectY += 22;
  }
  if (me.hasMultiplier) {
    ctx.fillText(`DMG x${me.multiplierValue.toFixed(2)}`, 12, effectY);
    effectY += 22;
  }
  if (me.hasTripleShot) {
    ctx.fillText("TRIPLE SHOT", 12, effectY);
    effectY += 22;
  }
  if (me.isReloading) {
    const leftMs = Math.max(0, (me.reloadEndsAt || 0) - Date.now());
    const left = (leftMs / 1000).toFixed(1);
    ctx.fillStyle = "#2bffb8";
    ctx.fillText(`RELOADING ${left}s`, 12, effectY);
    ctx.fillStyle = "#e8edf5";
  }

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

function render(nowPerf = performance.now()) {
  const nowMs = Date.now();
  updateMatchTopbar();
  drawArena(nowPerf);
  drawPickup(nowPerf);
  drawTracers(nowMs);
  drawPlayers(nowPerf);
  drawMuzzle(nowMs);
  drawBurst(nowMs);
  drawFloatTexts(nowMs);
  drawHud(nowPerf);
  requestAnimationFrame(render);
}

render();
