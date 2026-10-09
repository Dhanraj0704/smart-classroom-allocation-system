const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const RoomAllocator = require("../public/allocator.js");
const store = require("./store");
const { ValidationError, cleanRoom, cleanClass } = require("./validate");

// ---- Minimal router (zero dependencies) ----
const routes = [];
const app = {
  get: (p, h) => routes.push(["GET", p, h]),
  post: (p, h) => routes.push(["POST", p, h]),
  put: (p, h) => routes.push(["PUT", p, h]),
  delete: (p, h) => routes.push(["DELETE", p, h])
};
function matchRoute(method, pathname) {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const names = [];
    const regex = new RegExp("^" + pattern.replace(/:([a-z]+)/gi, (_, n) => { names.push(n); return "([^/]+)"; }) + "/?$");
    const hit = regex.exec(pathname);
    if (hit) return { handler, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])) };
  }
  return null;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > 2e6) { reject(Object.assign(new Error("Request body too large."), { status: 413 })); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on("end", () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Invalid JSON body."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}
function wrapRes(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(data)); };
  return res;
}

const newId = prefix => `${prefix}${crypto.randomBytes(6).toString("hex")}`;
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const conflict = message => Object.assign(new Error(message), { status: 409 });
const notFound = what => Object.assign(new Error(`${what} not found.`), { status: 404 });
// Any change to rooms/classes makes the previous plan stale.
const invalidate = () => { store.get().allocation = null; };

function assertRoomUnique(room, rooms) {
  if (rooms.some(r => r.id !== room.id && same(r.roomNumber, room.roomNumber) && same(r.block, room.block))) {
    throw conflict("A classroom with this number already exists in that block.");
  }
}
function assertClassUnique(item, classes) {
  if (classes.some(c => c.id !== item.id && same(c.classNo, item.classNo))) {
    throw conflict("A needed class with this number is already saved.");
  }
}

// Why a class could not be placed (same logic the UI used to compute locally).
function unassignedReason(item, rooms) {
  if (!rooms.length) return "Add classrooms first";
  const enoughSeats = rooms.filter(r => r.capacity >= item.enrollment);
  if (!enoughSeats.length) return "Not enough seats";
  const withFacilities = enoughSeats.filter(r => item.facilities.every(f => r.facilities.includes(f)));
  if (!withFacilities.length) return "Required facilities unavailable";
  const slot = RoomAllocator.slotKey(item.day, item.period);
  if (!withFacilities.some(r => r.availableSlots.includes(slot))) return "No room available at this time";
  return "All suitable rooms are in use";
}

function runAllocation() {
  const { rooms, classes } = store.get();
  const assignments = RoomAllocator.optimize(classes, rooms);
  const reasons = {};
  classes.forEach(item => { if (!assignments[item.id]) reasons[item.id] = unassignedReason(item, rooms); });
  return {
    assignments,
    reasons,
    placed: Object.keys(assignments).length,
    total: classes.length,
    generatedAt: new Date().toISOString()
  };
}

const wrap = handler => handler;

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/meta", (req, res) => res.json({
  days: RoomAllocator.DAYS,
  periods: RoomAllocator.PERIODS,
  facilities: require("./validate").FACILITIES
}));

app.get("/api/state", (req, res) => {
  const { rooms, classes, allocation } = store.get();
  res.json({ rooms, classes, allocation });
});

// Bulk replace — used to migrate data a browser had saved in localStorage.
app.put("/api/state", wrap(async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.rooms) || !Array.isArray(body.classes)) {
    throw new ValidationError("Body must contain rooms and classes arrays.");
  }
  const rooms = body.rooms.map(r => cleanRoom(r, String(r.id || newId("r"))));
  const classes = body.classes.map(c => cleanClass(c, String(c.id || newId("c"))));
  rooms.forEach((room, i) => assertRoomUnique(room, rooms.slice(0, i)));
  classes.forEach((item, i) => assertClassUnique(item, classes.slice(0, i)));
  await store.replace({ rooms, classes });
  res.json({ rooms, classes, allocation: null });
}));

// ---- Rooms ----
app.get("/api/rooms", (req, res) => res.json(store.get().rooms));

app.post("/api/rooms", wrap(async (req, res) => {
  const room = cleanRoom(req.body || {}, newId("r"));
  assertRoomUnique(room, store.get().rooms);
  store.get().rooms.push(room);
  invalidate();
  await store.save();
  res.status(201).json(room);
}));

app.put("/api/rooms/:id", wrap(async (req, res) => {
  const s = store.get();
  const index = s.rooms.findIndex(r => r.id === req.params.id);
  if (index < 0) throw notFound("Classroom");
  const room = cleanRoom(req.body || {}, req.params.id);
  assertRoomUnique(room, s.rooms);
  s.rooms[index] = room;
  invalidate();
  await store.save();
  res.json(room);
}));

app.delete("/api/rooms/:id", wrap(async (req, res) => {
  const s = store.get();
  if (!s.rooms.some(r => r.id === req.params.id)) throw notFound("Classroom");
  s.rooms = s.rooms.filter(r => r.id !== req.params.id);
  invalidate();
  await store.save();
  res.status(204).end();
}));

// ---- Classes ----
app.get("/api/classes", (req, res) => res.json(store.get().classes));

app.post("/api/classes", wrap(async (req, res) => {
  const item = cleanClass(req.body || {}, newId("c"));
  assertClassUnique(item, store.get().classes);
  store.get().classes.push(item);
  invalidate();
  await store.save();
  res.status(201).json(item);
}));

app.put("/api/classes/:id", wrap(async (req, res) => {
  const s = store.get();
  const index = s.classes.findIndex(c => c.id === req.params.id);
  if (index < 0) throw notFound("Class");
  const item = cleanClass(req.body || {}, req.params.id);
  assertClassUnique(item, s.classes);
  s.classes[index] = item;
  invalidate();
  await store.save();
  res.json(item);
}));

app.delete("/api/classes/:id", wrap(async (req, res) => {
  const s = store.get();
  if (!s.classes.some(c => c.id === req.params.id)) throw notFound("Class");
  s.classes = s.classes.filter(c => c.id !== req.params.id);
  invalidate();
  await store.save();
  res.status(204).end();
}));

// ---- Allocation ----
app.get("/api/allocation", (req, res) => res.json(store.get().allocation));

app.post("/api/allocation", wrap(async (req, res) => {
  const { rooms, classes } = store.get();
  if (!rooms.length) throw new ValidationError("Add available classrooms before generating an allocation.");
  if (!classes.length) throw new ValidationError("Enter the needed classes before generating an allocation.");
  const allocation = runAllocation();
  store.get().allocation = allocation;
  await store.save();
  res.json(allocation);
}));

// ---- Static frontend + dispatch ----
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return res.status(403).json({ error: "Forbidden." });
  fs.readFile(file, (error, data) => {
    if (error) return res.status(404).json({ error: "Not found." });
    res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  wrapRes(res);
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname.startsWith("/api/")) {
      const found = matchRoute(req.method, pathname);
      if (!found) return res.status(404).json({ error: "Not found." });
      req.params = found.params;
      req.body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
      return await found.handler(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).json({ error: "Method not allowed." });
    serveStatic(pathname, res);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? "Internal server error." : error.message });
  }
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Roomwise running at http://localhost:${port}`));
}

module.exports = server;
