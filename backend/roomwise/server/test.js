// End-to-end API test: node server/test.js
const os = require("os"), path = require("path"), assert = require("assert");
process.env.DATA_FILE = path.join(os.tmpdir(), `roomwise-test-${process.pid}.json`);
const server = require("./server");
const store = require("./store");

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    return { status: res.status, data: res.status === 204 ? null : await res.json() };
  };
  const all = ["Monday","Tuesday","Wednesday","Thursday","Friday"].flatMap(d => ["P1","P2","P3","P4","P5"].map(p => `${d}|${p}`));
  const room = (n, cap, fac = []) => ({ roomNumber: n, block: "Main", capacity: cap, facilities: fac, availableSlots: all });
  const cls = (no, n, fac = [], extra = {}) => ({ classNo: no, subject: "S" + no, enrollment: n, day: "Monday", period: "P1", facilities: fac, ...extra });

  let r = await call("POST", "/api/allocation");
  assert.equal(r.status, 400, "allocate with nothing must fail");

  const small = (await call("POST", "/api/rooms", room("101", 30))).data;
  const big = (await call("POST", "/api/rooms", room("201", 100, ["Projector", "Lab PCs"]))).data;
  assert.equal((await call("POST", "/api/rooms", room("101", 40))).status, 409, "duplicate room");
  assert.equal((await call("POST", "/api/rooms", { ...room("X", 0) })).status, 400, "bad capacity");
  assert.equal((await call("POST", "/api/rooms", { ...room("X", 5, ["Jetpack"]) })).status, 400, "bad facility");

  const a = (await call("POST", "/api/classes", cls("A", 25))).data;          // fits small (less waste)
  const b = (await call("POST", "/api/classes", cls("B", 60, ["Lab PCs"]))).data; // only big
  const c = (await call("POST", "/api/classes", cls("C", 20))).data;          // both rooms taken -> unplaced
  const d = (await call("POST", "/api/classes", cls("D", 500))).data;         // no seats
  assert.equal((await call("POST", "/api/classes", cls("a", 10))).status, 409, "duplicate class (case-insens.)");
  assert.equal((await call("POST", "/api/classes", cls("Z", 10, [], { day: "Sunday" }))).status, 400, "bad day");

  const alloc = (await call("POST", "/api/allocation")).data;
  assert.equal(alloc.assignments[a.id], small.id);
  assert.equal(alloc.assignments[b.id], big.id);
  assert.equal(alloc.placed, 2);
  assert.equal(alloc.reasons[c.id], "All suitable rooms are in use");
  assert.equal(alloc.reasons[d.id], "Not enough seats");
  assert.equal((await call("GET", "/api/allocation")).data.placed, 2, "plan persisted");

  assert.equal((await call("PUT", `/api/rooms/${small.id}`, room("101", 35))).status, 200);
  assert.equal((await call("GET", "/api/allocation")).data, null, "edit invalidates plan");
  assert.equal((await call("PUT", "/api/rooms/nope", room("9", 5))).status, 404);
  assert.equal((await call("DELETE", `/api/classes/${d.id}`)).status, 204);
  assert.equal((await call("GET", "/api/classes")).data.length, 3);

  await store.flush();
  assert.ok(require("fs").existsSync(process.env.DATA_FILE), "data file written");
  assert.equal((await fetch(base + "/")).status, 200, "serves index.html");
  assert.equal((await fetch(base + "/..%2Fserver%2Fstore.js")).status, 404, "no path traversal");
  console.log("All API tests passed");
  server.close(); require("fs").unlinkSync(process.env.DATA_FILE);
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
