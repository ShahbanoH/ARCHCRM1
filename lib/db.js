import { Pool } from "pg";

let pool;

export class NoDatabaseError extends Error {
  constructor() {
    super("DATABASE_URL is not set");
    this.code = "NO_DATABASE";
  }
}

function getPool() {
  if (!process.env.DATABASE_URL) throw new NoDatabaseError();
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost")
        ? false
        : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

// Columns added after the initial schema.sql shipped. Runs once per server
// boot so already-deployed databases upgrade themselves.
let migration;
function migrate(pool) {
  if (!migration) {
    migration = pool
      .query("ALTER TABLE contacts ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''")
      .catch((err) => {
        migration = undefined;
        throw err;
      });
  }
  return migration;
}

export async function query(text, params) {
  const pool = getPool();
  await migrate(pool);
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const pool = getPool();
  await migrate(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function noDbResponse() {
  return Response.json(
    {
      error: "no_database",
      message:
        "No database connected yet. In Vercel: Storage tab -> Create Database -> Postgres, then run schema.sql in the Neon SQL Editor and redeploy.",
    },
    { status: 503 }
  );
}
