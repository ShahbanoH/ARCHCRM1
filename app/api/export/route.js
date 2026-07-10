import { query, noDbResponse } from "@/lib/db";

export const dynamic = "force-dynamic";

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Exports every contact with its fund / platform / brand path as CSV.
export async function GET() {
  try {
    const { rows } = await query(`
      SELECT
        c.name, c.title, c.linkedin, c.email, c.phone, c.stage, c.response,
        e.kind AS level, e.name AS company,
        p.name AS parent_name, p.kind AS parent_kind,
        g.name AS grandparent_name
      FROM contacts c
      JOIN entities e ON e.id = c.entity_id
      LEFT JOIN entities p ON p.id = e.parent_id
      LEFT JOIN entities g ON g.id = p.parent_id
      ORDER BY COALESCE(g.id, p.id, e.id), e.id, c.id
    `);

    const header = ["Fund", "Platform", "Brand", "Level", "Name", "Role", "LinkedIn", "Email", "Phone", "Stage", "Response"];
    const lines = [header.join(",")];
    for (const r of rows) {
      let fund = "", platform = "", brand = "";
      if (r.level === "fund") {
        fund = r.company;
      } else if (r.level === "platform") {
        fund = r.parent_name ?? "";
        platform = r.company;
      } else {
        brand = r.company;
        platform = r.parent_name ?? "";
        fund = r.grandparent_name ?? "";
      }
      lines.push(
        [fund, platform, brand, r.level, r.name, r.title, r.linkedin, r.email, r.phone, r.stage, r.response]
          .map(csvCell)
          .join(",")
      );
    }

    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="arch-crm-export.csv"`,
      },
    });
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("GET /api/export failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}
