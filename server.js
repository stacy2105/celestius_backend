const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const EVENT_CAPACITY = 50;
const EVENT_NAME = "Backend Development Workshop";
const EVENT_DATE = "2026-10-20";

app.use(express.json({ limit: "10kb" }));

// SQLite stores registrations in a local database file.
const db = new Database(path.join(__dirname, "registrations.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    college_department TEXT,
    registered_at TEXT NOT NULL
  )
`);

const countRegistrations = db.prepare(
  "SELECT COUNT(*) AS count FROM registrations"
);
const findByEmail = db.prepare(
  "SELECT id, name, email, college_department, registered_at FROM registrations WHERE email = ?"
);
const findById = db.prepare(
  "SELECT id, name, email, college_department, registered_at FROM registrations WHERE id = ?"
);
const listRegistrations = db.prepare(
  "SELECT id, name, email, college_department, registered_at FROM registrations ORDER BY registered_at ASC, id ASC"
);
const insertRegistration = db.prepare(`
  INSERT INTO registrations (name, email, college_department, registered_at)
  VALUES (@name, @email, @college_department, @registered_at)
`);

// The transaction checks capacity and inserts together, preventing two requests
// from both claiming the final seat.
const registerStudent = db.transaction((student) => {
  const currentCount = countRegistrations.get().count;

  if (currentCount >= EVENT_CAPACITY) {
    return { full: true };
  }

  try {
    const result = insertRegistration.run(student);
    return {
      full: false,
      registration: findById.get(result.lastInsertRowid)
    };
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { duplicate: true };
    }
    throw error;
  }
});

function cleanOptionalText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

app.get("/", (req, res) => {
  res.json({
    message: "Celestius Event Registration API",
    event: { name: EVENT_NAME, date: EVENT_DATE, capacity: EVENT_CAPACITY },
    endpoints: {
      register: "POST /register",
      list: "GET /registrations",
      single: "GET /registrations/:id",
      eventStatus: "GET /event"
    }
  });
});

app.get("/event", (req, res) => {
  const registered = countRegistrations.get().count;
  res.json({
    event: EVENT_NAME,
    date: EVENT_DATE,
    capacity: EVENT_CAPACITY,
    registered,
    seatsRemaining: Math.max(EVENT_CAPACITY - registered, 0),
    isFull: registered >= EVENT_CAPACITY
  });
});

app.post("/register", (req, res) => {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Request body must be a JSON object." });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const collegeDepartment = cleanOptionalText(body.collegeDepartment);

  if (!name || !email) {
    return res.status(400).json({
      error: "Name and email are required.",
      requiredFields: ["name", "email"]
    });
  }

  if (name.length > 100) {
    return res.status(400).json({ error: "Name must be 100 characters or fewer." });
  }

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }

  if (collegeDepartment === undefined) {
    return res.status(400).json({
      error: "collegeDepartment must be a string when provided."
    });
  }

  if (collegeDepartment && collegeDepartment.length > 150) {
    return res.status(400).json({
      error: "College/department must be 150 characters or fewer."
    });
  }

  // Check duplicates before capacity so an existing participant gets a clear error.
  if (findByEmail.get(email)) {
    return res.status(409).json({
      error: "This email is already registered for the event."
    });
  }

  const result = registerStudent({
    name,
    email,
    college_department: collegeDepartment,
    registered_at: new Date().toISOString()
  });

  if (result.duplicate) {
    return res.status(409).json({
      error: "This email is already registered for the event."
    });
  }

  if (result.full) {
    return res.status(409).json({ error: "Event is full." });
  }

  return res.status(201).json({
    message: "Registration successful.",
    registration: result.registration
  });
});

app.get("/registrations", (req, res) => {
  const registrations = listRegistrations.all();
  res.json({
    count: registrations.length,
    capacity: EVENT_CAPACITY,
    registrations
  });
});

app.get("/registrations/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Registration ID must be a positive integer." });
  }

  const registration = findById.get(id);
  if (!registration) {
    return res.status(404).json({ error: "Registration not found." });
  }

  return res.json({ registration });
});

// Return a consistent JSON error for malformed JSON request bodies.
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON request body." });
  }
  return next(error);
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Celestius Event Registration API running at http://localhost:${PORT}`);
});
