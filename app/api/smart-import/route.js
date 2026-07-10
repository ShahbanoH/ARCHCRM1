import { withTransaction, noDbResponse } from "@/lib/db";
import { findMatch, indexEntity, parseSubsidiary, extractDomain } from "@/lib/match";

export const dynamic = "force-dynamic";

// Smart import for Apollo exports. Accepts:
//   { kind: "companies", rows: [{name, website, linkedin, location, revenue, subsidiary}] }
//   { kind: "people",    rows: [{name, linkedin, email, phone, company: {same shape as above}}] }
// Companies are matched to existing funds/platforms/brands by domain or name;
// matches get blank info fields backfilled, misses are created under the parent
// implied by "Subsidiary of" (or an "Unassigned" bucket). People are attached
// to their company's entity and deduped by email/linkedin/name.

const INFO_FIELDS = ["linkedin", "website", "location", "revenue"];

export async function POST(request) {
  try {
    const { kind, rows = [] } = await request.json();
    if (!["companies", "people"].includes(kind) || rows.length === 0) {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }

    const summary = await withTransaction(async (client) => {
      const entityRes = await client.query("SELECT * FROM entities");
      const entities = entityRes.rows.map(indexEntity);
      const contactRes = await client.query("SELECT id, entity_id, name, linkedin, email FROM contacts");
      const contactKeys = new Set();
      for (const c of contactRes.rows) {
        if (c.email) contactKeys.add(`${c.entity_id}|e|${c.email.toLowerCase()}`);
        if (c.linkedin) contactKeys.add(`${c.entity_id}|l|${c.linkedin.toLowerCase()}`);
        if (c.name) contactKeys.add(`${c.entity_id}|n|${c.name.toLowerCase()}`);
      }

      const counts = {
        companiesMatched: 0,
        companiesCreated: 0,
        companiesUpdated: 0,
        contactsAdded: 0,
        contactsSkipped: 0,
        rowsSkipped: 0,
      };

      async function insertEntity(kind_, parentId, name, info) {
        const { rows: inserted } = await client.query(
          `INSERT INTO entities (kind, parent_id, name, linkedin, website, location, revenue)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            kind_,
            parentId,
            name.trim(),
            info.linkedin || "",
            info.website || "",
            info.location || "",
            info.revenue || "",
          ]
        );
        const entity = indexEntity(inserted[0]);
        entities.push(entity);
        return entity;
      }

      async function ensureUnassignedPlatform() {
        let fund = entities.find((e) => e.kind === "fund" && e._norm === "unassigned");
        if (!fund) fund = await insertEntity("fund", null, "Unassigned", {});
        let platform = entities.find(
          (e) => e.kind === "platform" && e._norm === "unassigned" && e.parent_id === fund.id
        );
        if (!platform) platform = await insertEntity("platform", fund.id, "Unassigned", {});
        return platform;
      }

      async function backfill(entity, info) {
        const fills = {};
        for (const field of INFO_FIELDS) {
          if (info[field]?.trim() && !entity[field]) fills[field] = info[field].trim();
        }
        if (Object.keys(fills).length === 0) return false;
        const cols = Object.keys(fills).map((c, i) => `${c} = $${i + 1}`);
        await client.query(
          `UPDATE entities SET ${cols.join(", ")} WHERE id = $${cols.length + 1}`,
          [...Object.values(fills), entity.id]
        );
        Object.assign(entity, fills);
        indexEntity(entity);
        return true;
      }

      // Resolves a company row to an entity, creating it if needed.
      async function resolveCompany(company) {
        if (!company?.name?.trim()) return null;
        const domain = extractDomain(company.website);
        const found = findMatch(entities, { name: company.name, domain });
        if (found) {
          counts.companiesMatched++;
          if (await backfill(found, company)) counts.companiesUpdated++;
          return found;
        }
        // Place the new company using "Subsidiary of" when available.
        let parentEntity = null;
        const sub = parseSubsidiary(company.subsidiary);
        if (sub) parentEntity = findMatch(entities, sub);
        let created;
        if (parentEntity?.kind === "brand") {
          created = await insertEntity("brand", parentEntity.parent_id, company.name, company);
        } else if (parentEntity?.kind === "platform") {
          created = await insertEntity("brand", parentEntity.id, company.name, company);
        } else if (parentEntity?.kind === "fund") {
          created = await insertEntity("platform", parentEntity.id, company.name, company);
        } else {
          const bucket = await ensureUnassignedPlatform();
          created = await insertEntity("brand", bucket.id, company.name, company);
        }
        counts.companiesCreated++;
        return created;
      }

      if (kind === "companies") {
        for (const row of rows) {
          if (!row?.name?.trim()) {
            counts.rowsSkipped++;
            continue;
          }
          await resolveCompany(row);
        }
      } else {
        for (const row of rows) {
          const hasPerson = row?.name?.trim() || row?.email?.trim();
          if (!hasPerson) {
            counts.rowsSkipped++;
            continue;
          }
          const entity = await resolveCompany(row.company);
          if (!entity) {
            counts.rowsSkipped++;
            continue;
          }
          const keys = [];
          if (row.email?.trim()) keys.push(`${entity.id}|e|${row.email.trim().toLowerCase()}`);
          if (row.linkedin?.trim()) keys.push(`${entity.id}|l|${row.linkedin.trim().toLowerCase()}`);
          if (row.name?.trim()) keys.push(`${entity.id}|n|${row.name.trim().toLowerCase()}`);
          if (keys.some((k) => contactKeys.has(k))) {
            counts.contactsSkipped++;
            continue;
          }
          await client.query(
            `INSERT INTO contacts (entity_id, name, linkedin, email, phone, stage, response)
             VALUES ($1, $2, $3, $4, $5, 1, '')`,
            [
              entity.id,
              (row.name || "").trim(),
              (row.linkedin || "").trim(),
              (row.email || "").trim(),
              (row.phone || "").trim(),
            ]
          );
          for (const k of keys) contactKeys.add(k);
          counts.contactsAdded++;
        }
      }

      return counts;
    });

    return Response.json(summary);
  } catch (err) {
    if (err.code === "NO_DATABASE") return noDbResponse();
    console.error("POST /api/smart-import failed:", err);
    return Response.json({ error: "db_error", message: err.message }, { status: 500 });
  }
}
