// Tiny JSON-file persistence. Writes are serialized and atomic (temp file + rename),
// so a crash mid-write can never leave a corrupt data file.
const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "..", "data", "roomwise.json");

const empty = () => ({ rooms: [], classes: [], allocation: null });
let state = load();
let writeChain = Promise.resolve();

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
      classes: Array.isArray(parsed.classes) ? parsed.classes : [],
      allocation: parsed.allocation || null
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read data file, starting empty:", error.message);
    return empty();
  }
}

function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  writeChain = writeChain.then(async () => {
    await fs.promises.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, DATA_FILE);
  }).catch(error => console.error("Failed to save data:", error));
  return writeChain;
}

module.exports = {
  get: () => state,
  save: persist,
  replace(next) { state = { rooms: next.rooms, classes: next.classes, allocation: null }; return persist(); },
  flush: () => writeChain
};
