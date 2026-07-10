import { query, noDbResponse } from "@/lib/db";

export const dynamic = "force-dynamic";

const CONTACT_FIELDS = ["name", "linkedin", "email", "phone", "stage", "response"];
const RESPONSES = ["", "Yes", "No", "Follow up", "Wrong info"];

function clean(contact) {
  const stage = Number(contact.stage);
  return {
    name: contact.name ?? "",
    linkedin: contact.linkedin ?? "",
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    stage: stage >= 1 && stage <= 5 ? stage : 1,
    response: RESPONSES.includes(contact.response) ? contact.response : "",
  };
}

// Creates one or many contacts: { entityId, contacts: [{...}] }
export async function POST(request) {
  try {
    const { entityId, contacts = [] } = await request.json();
    if (!entityId || contacts.length === 0) {
      return Response.json({ error: "missing_data" }, { status: 400 });
    }
    const values = [];
    const placeholders = contacts.map((raw, i) => {
      const c = clean(raw);
      values.push(entityId, c.name, c.linkedin, c.email, c.phone, c.stage, c.response);
      const base = i * 7;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    const { rows } = await query(
      `INSERT INTO contacts (entity_id, name, linkedin, email, phone, stage, response)
       VALUES ${placeholders.join(", ")} RETURNING *`,
      values
    );
    return Response.json({ contacts: rows });
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("POST /api/contacts failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { id, ...fields } = await request.json();
    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
      if (CONTACT_FIELDS.includes(key)) {
        values.push(key === "stage" ? Number(value) || 1 : value ?? "");
        sets.push(`${key} = $${values.length}`);
      }
    }
    if (!id || sets.length === 0) {
      return Response.json({ error: "nothing_to_update" }, { status: 400 });
    }
    values.push(id);
    const { rows } = await query(
      `UPDATE contacts SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return Response.json(rows[0] ?? null);
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("PATCH /api/contacts failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "missing_id" }, { status: 400 });
    await query("DELETE FROM contacts WHERE id = $1", [id]);
    return Response.json({ ok: true });
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("DELETE /api/contacts failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}
