import { withTransaction, noDbResponse } from "@/lib/db";

export const dynamic = "force-dynamic";

// Bulk structure import: builds the fund -> platform -> brand tree from rows
// like {name, type, linkedin, website, sponsor, platform}. Re-importing the
// same file is safe: entities are matched by kind + name, and blank
// linkedin/website fields get filled in rather than duplicated.

function normType(type) {
  const t = (type || "").trim().toLowerCase();
  if (["pe firm", "pe fund", "fund", "firm", "sponsor"].includes(t)) return "fund";
  if (t === "platform") return "platform";
  if (t === "brand") return "brand";
  return null;
}

const key = (kind, name) => `${kind}::${name.trim().toLowerCase()}`;

export async function POST(request) {
  try {
    const { rows = [] } = await request.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ error: "no_rows" }, { status: 400 });
    }

    const summary = await withTransaction(async (client) => {
      const existing = await client.query(
        "SELECT id, kind, name, linkedin, website FROM entities"
      );
      const byKey = new Map(existing.rows.map((r) => [key(r.kind, r.name), r]));
      const created = { fund: 0, platform: 0, brand: 0 };
      let updated = 0;
      let skipped = 0;

      async function ensure(kind, name, parentId, info = {}) {
        const k = key(kind, name);
        const found = byKey.get(k);
        if (found) {
          const fills = {};
          for (const field of ["linkedin", "website"]) {
            if (info[field]?.trim() && !found[field]) fills[field] = info[field].trim();
          }
          if (Object.keys(fills).length > 0) {
            const cols = Object.keys(fills).map((c, i) => `${c} = $${i + 1}`);
            await client.query(
              `UPDATE entities SET ${cols.join(", ")} WHERE id = $${cols.length + 1}`,
              [...Object.values(fills), found.id]
            );
            Object.assign(found, fills);
            updated++;
          }
          return found;
        }
        const inserted = await client.query(
          `INSERT INTO entities (kind, parent_id, name, linkedin, website)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, kind, name, linkedin, website`,
          [kind, parentId, name.trim(), (info.linkedin || "").trim(), (info.website || "").trim()]
        );
        byKey.set(k, inserted.rows[0]);
        created[kind]++;
        return inserted.rows[0];
      }

      const typed = rows.map((r) => ({ ...r, kind: normType(r.type) }));
      skipped = typed.filter((r) => !r.kind || !(r.name || "").trim()).length;

      // Three passes so parents always exist before children, regardless of row order.
      for (const r of typed) {
        if (r.kind === "fund" && r.name?.trim()) await ensure("fund", r.name, null, r);
      }
      for (const r of typed) {
        if (r.kind !== "platform" || !r.name?.trim()) continue;
        const sponsor = (r.sponsor || "").trim() || "Unassigned";
        const fund = await ensure("fund", sponsor, null, {});
        await ensure("platform", r.name, fund.id, r);
      }
      for (const r of typed) {
        if (r.kind !== "brand" || !r.name?.trim()) continue;
        const platformName = (r.platform || "").trim() || "Unassigned";
        let platform = byKey.get(key("platform", platformName));
        if (!platform) {
          const fund = await ensure("fund", "Unassigned", null, {});
          platform = await ensure("platform", platformName, fund.id, {});
        }
        await ensure("brand", r.name, platform.id, r);
      }

      return { created, updated, skipped };
    });

    return Response.json(summary);
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("POST /api/import failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}
