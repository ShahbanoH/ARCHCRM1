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

export function query(text, params) {
  return getPool().query(text, params);
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
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
