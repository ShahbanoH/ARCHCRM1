import { query, noDbResponse } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [entities, contacts] = await Promise.all([
      query("SELECT * FROM entities ORDER BY id"),
      query("SELECT * FROM contacts ORDER BY id"),
    ]);

    const byId = new Map();
    for (const e of entities.rows) {
      byId.set(e.id, { ...e, contacts: [], children: [] });
    }
    for (const c of contacts.rows) {
      const owner = byId.get(c.entity_id);
      if (owner) owner.contacts.push(c);
    }
    const funds = [];
    for (const e of byId.values()) {
      if (e.parent_id && byId.has(e.parent_id)) {
        byId.get(e.parent_id).children.push(e);
      } else if (e.kind === "fund") {
        funds.push(e);
      }
    }
    return Response.json({ funds });
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("GET /api/tree failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}
