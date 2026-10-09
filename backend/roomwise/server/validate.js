const { DAYS, PERIODS, slotKey } = require("../public/allocator.js");

const FACILITIES = ["Projector", "Smart board", "Lab PCs", "Recording"];
const ALL_SLOTS = DAYS.flatMap(day => PERIODS.map(period => slotKey(day, period.id)));

class ValidationError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

function text(value, field, { max, required = true } = {}) {
  const str = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  if (required && !str) throw new ValidationError(`${field} is required.`);
  if (str.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
  return str;
}

function integer(value, field, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ValidationError(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return number;
}

function list(value, field, allowed) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be a list.`);
  const unique = [...new Set(value.map(String))];
  const bad = unique.find(item => !allowed.includes(item));
  if (bad) throw new ValidationError(`${field} contains an invalid value: ${bad}`);
  return unique;
}

function cleanRoom(input, id) {
  return {
    id,
    roomNumber: text(input.roomNumber, "Classroom number", { max: 30 }),
    block: text(input.block, "Block / building", { max: 50 }),
    capacity: integer(input.capacity, "Number of seats", 1, 1000),
    facilities: list(input.facilities, "Facilities", FACILITIES),
    availableSlots: list(input.availableSlots, "Available slots", ALL_SLOTS)
  };
}

function cleanClass(input, id) {
  const subject = text(input.subject ?? input.name, "Class name / subject", { max: 80 });
  const day = String(input.day ?? "");
  const period = String(input.period ?? "");
  if (!DAYS.includes(day)) throw new ValidationError("Day is invalid.");
  if (!PERIODS.some(item => item.id === period)) throw new ValidationError("Class time is invalid.");
  return {
    id,
    classNo: text(input.classNo, "Class number / code", { max: 30 }),
    subject,
    name: subject,
    department: text(input.department, "Department", { max: 50, required: false }),
    enrollment: integer(input.enrollment, "Number of students", 1, 1000),
    day,
    period,
    preferredBlock: text(input.preferredBlock, "Preferred block", { max: 50, required: false }),
    facilities: list(input.facilities, "Required facilities", FACILITIES)
  };
}

module.exports = { ValidationError, cleanRoom, cleanClass, FACILITIES, ALL_SLOTS };
