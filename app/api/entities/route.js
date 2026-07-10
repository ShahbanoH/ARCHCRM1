import { query, noDbResponse } from "@/lib/db";

export const dynamic = "force-dynamic";

const ENTITY_FIELDS = ["name", "linkedin", "website", "location", "revenue"];

export async function POST(request) {
  try {
    const body = await request.json();
    const { kind, parentId = null, name = "" } = body;
    if (!["fund", "platform", "brand"].includes(kind)) {
      return Response.json({ error: "invalid_kind" }, { status: 400 });
    }
    const { rows } = await query(
      "INSERT INTO entities (kind, parent_id, name) VALUES ($1, $2, $3) RETURNING *",
      [kind, parentId, name]
    );
    return Response.json(rows[0]);
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("POST /api/entities failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { id, ...fields } = await request.json();
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
      if (ENTITY_FIELDS.includes(key)) {
        values.push(value ?? "");
        sets.push(`${key} = $${values.length}`);
      }
    }
    if (!id || sets.length === 0) {
      return Response.json({ error: "nothing_to_update" }, { status: 400 });
    }
    values.push(id);
    const { rows } = await query(
      `UPDATE entities SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return Response.json(rows[0] ?? null);
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("PATCH /api/entities failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
    await query("DELETE FROM entities WHERE id = $1", [id]);
    return Response.json({ ok: true });
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("DELETE /api/entities failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}
