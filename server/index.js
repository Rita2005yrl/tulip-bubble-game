import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { addPlayer, createLobby, createPlayerView, performAction } from "../game-engine.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = resolve(process.env.DATA_DIR || "data");
const STATIC_DIR = resolve(process.env.STATIC_DIR || "dist");
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 14;
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp",
};

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(resolve(DATA_DIR, "rooms.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY, state_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS room_players (
    room_code TEXT NOT NULL, player_id INTEGER NOT NULL, token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_code, player_id), UNIQUE (room_code, token_hash)
  );
  CREATE INDEX IF NOT EXISTS rooms_expires_idx ON rooms(expires_at);
`);

const now = () => Math.floor(Date.now() / 1000);
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const token = () => randomBytes(30).toString("base64url");
const roomCode = () => Array.from(randomBytes(6), (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("请求内容过大");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function loadRoom(code) {
  const row = db.prepare("SELECT state_json, revision, expires_at FROM rooms WHERE code = ?").get(code);
  if (!row || Number(row.expires_at) < now()) return null;
  const state = JSON.parse(row.state_json);
  state.revision = Number(row.revision);
  return state;
}

function authenticate(code, req) {
  const authorization = req.headers.authorization || "";
  const value = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!value) return null;
  const row = db.prepare("SELECT player_id FROM room_players WHERE room_code = ? AND token_hash = ?").get(code, tokenHash(value));
  return row ? Number(row.player_id) : null;
}

function createRoom(payload) {
  const maxPlayers = Math.min(5, Math.max(3, Number(payload.maxPlayers) || 3));
  let code;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = roomCode();
    if (!db.prepare("SELECT 1 FROM rooms WHERE code = ?").get(candidate)) { code = candidate; break; }
  }
  if (!code) throw new Error("无法生成房间码，请重试");
  const playerToken = token();
  const state = createLobby(payload.name, maxPlayers);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO rooms (code, state_json, revision, expires_at) VALUES (?, ?, ?, ?)")
      .run(code, JSON.stringify(state), state.revision, now() + ROOM_TTL_SECONDS);
    db.prepare("INSERT INTO room_players (room_code, player_id, token_hash) VALUES (?, 0, ?)")
      .run(code, tokenHash(playerToken));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { roomCode: code, playerId: 0, token: playerToken, state: createPlayerView(state, 0) };
}

function joinRoom(code, payload) {
  const state = loadRoom(code);
  if (!state) return { status: 404, data: { error: "房间不存在或已经过期" } };
  const oldRevision = Number(state.revision);
  const playerId = addPlayer(state, payload.name);
  const playerToken = token();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare("UPDATE rooms SET state_json = ?, revision = ?, updated_at = CURRENT_TIMESTAMP, expires_at = ? WHERE code = ? AND revision = ?")
      .run(JSON.stringify(state), state.revision, now() + ROOM_TTL_SECONDS, code, oldRevision);
    if (!result.changes) throw new Error("另一位玩家刚刚加入，请重试");
    db.prepare("INSERT INTO room_players (room_code, player_id, token_hash) VALUES (?, ?, ?)")
      .run(code, playerId, tokenHash(playerToken));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { status: 201, data: { roomCode: code, playerId, token: playerToken, state: createPlayerView(state, playerId) } };
}

function handleAction(code, playerId, payload) {
  const state = loadRoom(code);
  if (!state) return { status: 404, data: { error: "房间不存在或已经过期" } };
  const oldRevision = Number(state.revision);
  performAction(state, playerId, payload.type, payload.payload || {});
  const result = db.prepare("UPDATE rooms SET state_json = ?, revision = ?, updated_at = CURRENT_TIMESTAMP, expires_at = ? WHERE code = ? AND revision = ?")
    .run(JSON.stringify(state), state.revision, now() + ROOM_TTL_SECONDS, code, oldRevision);
  if (!result.changes) return { status: 409, data: { error: "房间刚刚发生了其他操作，请再试一次" } };
  return { status: 200, data: { state: createPlayerView(state, playerId) } };
}

async function handleApi(req, res, pathname) {
  const path = pathname.split("/").filter(Boolean);
  try {
    const payload = req.method === "POST" ? await readJson(req) : {};
    if (req.method === "POST" && path.join("/") === "api/rooms") return sendJson(res, createRoom(payload), 201);
    if (path[0] === "api" && path[1] === "rooms" && path[2]) {
      const code = path[2].toUpperCase();
      if (req.method === "POST" && path[3] === "join") {
        const result = joinRoom(code, payload); return sendJson(res, result.data, result.status);
      }
      const playerId = authenticate(code, req);
      if (playerId === null) return sendJson(res, { error: "玩家凭证无效，请重新加入房间" }, 401);
      if (req.method === "GET" && path.length === 3) {
        const state = loadRoom(code);
        return state ? sendJson(res, { state: createPlayerView(state, playerId) }) : sendJson(res, { error: "房间不存在或已经过期" }, 404);
      }
      if (req.method === "POST" && path[3] === "actions") {
        const result = handleAction(code, playerId, payload); return sendJson(res, result.data, result.status);
      }
    }
    return sendJson(res, { error: "接口不存在" }, 404);
  } catch (error) {
    const message = error instanceof SyntaxError ? "请求格式错误" : error.message || "服务器操作失败";
    return sendJson(res, { error: message }, error instanceof SyntaxError ? 400 : 400);
  }
}

function serveStatic(res, pathname) {
  const decoded = decodeURIComponent(pathname);
  let filePath = resolve(STATIC_DIR, `.${decoded}`);
  if (!filePath.startsWith(`${STATIC_DIR}${sep}`) && filePath !== STATIC_DIR) return sendJson(res, { error: "禁止访问" }, 403);
  if (!existsSync(filePath) || !extname(filePath)) filePath = resolve(STATIC_DIR, "index.html");
  try {
    const body = readFileSync(filePath);
    res.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch { sendJson(res, { error: "静态文件不存在，请先执行构建" }, 404); }
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) return void handleApi(req, res, url.pathname);
  serveStatic(res, url.pathname);
});

setInterval(() => {
  const expired = db.prepare("SELECT code FROM rooms WHERE expires_at < ?").all(now());
  const removePlayers = db.prepare("DELETE FROM room_players WHERE room_code = ?");
  const removeRoom = db.prepare("DELETE FROM rooms WHERE code = ?");
  for (const row of expired) { removePlayers.run(row.code); removeRoom.run(row.code); }
}, 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => console.log(`郁金香泡泡已启动：http://${HOST}:${PORT}`));
