const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_BASE_URL = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], sessions: {}, chats: {} }, null, 2));

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { users: [], sessions: {}, chats: {} }; }
}
function writeDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function send(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
}
function cookieValue(req, name) {
  const cookies = (req.headers.cookie || "").split(";").map(x => x.trim());
  const found = cookies.find(x => x.startsWith(name + "="));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}
function currentUser(req, db) {
  const sid = cookieValue(req, "hmz_session");
  const uid = db.sessions[sid];
  return uid ? db.users.find(u => u.id === uid) : null;
}
function makeId() { return crypto.randomBytes(18).toString("hex"); }
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, user) {
  const candidate = crypto.scryptSync(password, user.salt, 64);
  const stored = Buffer.from(user.passwordHash, "hex");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) { reject(new Error("Request too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
function cleanChat(chat) {
  return { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, messages: chat.messages };
}
async function handleAPI(req, res, pathname) {
  const db = readDB();
  if (req.method === "POST" && pathname === "/api/register") {
    let body;
    try { body = await parseBody(req); } catch { return send(res, 400, { error: "Invalid request." }); }
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim().slice(0, 40);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: "Enter a name and valid email." });
    if (password.length < 8) return send(res, 400, { error: "Password must be at least 8 characters." });
    if (db.users.some(u => u.email === email)) return send(res, 409, { error: "An account with this email already exists." });
    const creds = hashPassword(password);
    const user = { id: makeId(), name, email, salt: creds.salt, passwordHash: creds.hash, createdAt: new Date().toISOString() };
    db.users.push(user);
    const sid = makeId();
    db.sessions[sid] = user.id;
    db.chats[user.id] = [];
    writeDB(db);
    return send(res, 201, { user: { id: user.id, name: user.name, email: user.email } }, {
      "Set-Cookie": `hmz_session=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
    });
  }
  if (req.method === "POST" && pathname === "/api/login") {
    let body;
    try { body = await parseBody(req); } catch { return send(res, 400, { error: "Invalid request." }); }
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = db.users.find(u => u.email === email);
    if (!user || !verifyPassword(password, user)) return send(res, 401, { error: "Email or password is incorrect." });
    const sid = makeId();
    db.sessions[sid] = user.id;
    writeDB(db);
    return send(res, 200, { user: { id: user.id, name: user.name, email: user.email } }, {
      "Set-Cookie": `hmz_session=${encodeURIComponent(sid)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`
    });
  }
  if (req.method === "POST" && pathname === "/api/logout") {
    const sid = cookieValue(req, "hmz_session");
    delete db.sessions[sid];
    writeDB(db);
    return send(res, 200, { ok: true }, { "Set-Cookie": "hmz_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
  }
  const user = currentUser(req, db);
  if (req.method === "GET" && pathname === "/api/me") {
    return send(res, 200, { user: user ? { id: user.id, name: user.name, email: user.email } : null, aiConfigured: Boolean(AI_API_KEY) });
  }
  if (!user) return send(res, 401, { error: "Please sign in first." });

  if (req.method === "GET" && pathname === "/api/chats") {
    return send(res, 200, { chats: (db.chats[user.id] || []).map(cleanChat).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)) });
  }
  if (req.method === "POST" && pathname === "/api/chats") {
    const chat = { id: makeId(), title: "New chat", updatedAt: new Date().toISOString(), messages: [] };
    db.chats[user.id] ||= [];
    db.chats[user.id].unshift(chat);
    writeDB(db);
    return send(res, 201, { chat: cleanChat(chat) });
  }
  const chatMatch = pathname.match(/^\/api\/chats\/([a-f0-9]+)$/);
  if (chatMatch && req.method === "DELETE") {
    db.chats[user.id] = (db.chats[user.id] || []).filter(c => c.id !== chatMatch[1]);
    writeDB(db);
    return send(res, 200, { ok: true });
  }
  const messageMatch = pathname.match(/^\/api\/chats\/([a-f0-9]+)\/messages$/);
  if (messageMatch && req.method === "POST") {
    const chat = (db.chats[user.id] || []).find(c => c.id === messageMatch[1]);
    if (!chat) return send(res, 404, { error: "Chat not found." });
    let body;
    try { body = await parseBody(req); } catch { return send(res, 400, { error: "Invalid request." }); }
    const content = String(body.content || "").trim().slice(0, 12000);
    if (!content) return send(res, 400, { error: "Write a message first." });
    if (!AI_API_KEY) return send(res, 503, { error: "AI is not connected yet. Add AI_API_KEY to the server environment to enable real AI replies." });
    chat.messages.push({ role: "user", content, createdAt: new Date().toISOString() });
    if (chat.title === "New chat") chat.title = content.slice(0, 42) + (content.length > 42 ? "…" : "");
    chat.updatedAt = new Date().toISOString();
    writeDB(db);
    try {
      const history = chat.messages.slice(-24).map(m => ({ role: m.role, content: m.content }));
      const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${AI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: "system", content: "You are HMZ AI, a helpful, honest, clear general-purpose assistant. Reply in the language used by the user unless they request otherwise. Do not claim you can do things you cannot do." },
            ...history
          ],
          temperature: 0.7
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || `AI provider returned HTTP ${response.status}`);
      const answer = data.choices?.[0]?.message?.content;
      if (!answer) throw new Error("The AI provider returned an empty answer.");
      chat.messages.push({ role: "assistant", content: String(answer), createdAt: new Date().toISOString() });
      chat.updatedAt = new Date().toISOString();
      writeDB(db);
      return send(res, 200, { chat: cleanChat(chat), reply: String(answer) });
    } catch (err) {
      return send(res, 502, { error: `AI request failed: ${err.message}` });
    }
  }
  return send(res, 404, { error: "Not found." });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    try { await handleAPI(req, res, url.pathname); }
    catch (err) { send(res, 500, { error: "Server error." }); }
    return;
  }
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const full = path.resolve(PUBLIC_DIR, "." + pathname);
  if (!full.startsWith(PUBLIC_DIR + path.sep) && full !== path.join(PUBLIC_DIR, "index.html")) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(full);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    res.end(data);
  });
});
server.listen(PORT, () => console.log(`HMZ AI is running at http://localhost:${PORT}`));
