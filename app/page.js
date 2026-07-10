"use client";

import { useEffect, useRef, useState } from "react";
import { formatRevenue } from "@/lib/match";

const KIND_LABEL = { fund: "PE Fund", platform: "Platform", brand: "Brand" };
const CHILD_KIND = { fund: "platform", platform: "brand" };
const RESPONSES = ["", "Yes", "No", "Follow up", "Wrong info"];

/* ---------- CSV parsing (handles quoted fields with commas/newlines) ---------- */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// Apollo prefixes phone numbers with an apostrophe to force text format.
function cleanPhone(value) {
  return (value || "").replace(/^['’\s]+/, "").trim();
}

function mapApolloRows(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const first = col("first name");
  const last = col("last name");
  const full = col("name", "full name", "contact name");
  const email = col("email", "email address", "work email");
  const title = col("title", "job title", "role");
  const linkedin = col("person linkedin url", "linkedin url", "linkedin", "linkedin profile");
  const phones = [
    col("mobile phone"),
    col("work direct phone"),
    col("corporate phone"),
    col("other phone"),
    col("phone", "phone number"),
  ].filter((i) => i !== -1);

  return rows.slice(1).map((r) => {
    const name =
      full !== -1 && r[full]?.trim()
        ? r[full].trim()
        : [first !== -1 ? r[first] : "", last !== -1 ? r[last] : ""]
            .map((s) => (s || "").trim())
            .filter(Boolean)
            .join(" ");
    let phone = "";
    for (const p of phones) {
      if (cleanPhone(r[p])) {
        phone = cleanPhone(r[p]);
        break;
      }
    }
    return {
      name,
      title: title !== -1 ? (r[title] || "").trim() : "",
      linkedin: linkedin !== -1 ? (r[linkedin] || "").trim() : "",
      email: email !== -1 ? (r[email] || "").trim() : "",
      phone,
      stage: 1,
      response: "",
    };
  });
}

// Maps a "master" structure CSV (Record/Name, Type, Sponsor, Platform,
// LinkedIn, Domains/Website) into rows for /api/import.
function mapStructureRows(rows) {
  if (rows.length < 2) return null;
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) {
      const idx = headers.indexOf(n);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const name = col("record", "name", "company");
  const type = col("type");
  if (name === -1 || type === -1) return null;
  const linkedin = col("linkedin", "linkedin url", "company linkedin url");
  const website = col("domains", "website", "domain");
  const sponsor = col("sponsor", "pe firm", "pe fund");
  const platform = col("platform");
  const pick = (r, i) => (i === -1 ? "" : (r[i] || "").trim());
  return rows.slice(1).map((r) => ({
    name: pick(r, name),
    type: pick(r, type),
    linkedin: pick(r, linkedin),
    website: pick(r, website),
    sponsor: pick(r, sponsor),
    platform: pick(r, platform),
  }));
}

// Figures out what kind of CSV was dropped from its headers.
function detectCSVKind(headers) {
  if (headers.includes("type")) return "structure";
  if (headers.includes("first name") || headers.includes("person linkedin url")) return "people";
  if (headers.includes("company name") || headers.includes("company")) return "companies";
  return null;
}

// Builds the shared company shape from an Apollo row (works for both
// people exports and account exports — same column names).
function companyFromApollo(r, col) {
  const city = col.pick(r, "company city");
  const state = col.pick(r, "company state");
  return {
    name: col.pick(r, "company name", "company"),
    website: col.pick(r, "website", "company website"),
    linkedin: col.pick(r, "company linkedin url"),
    location: [city, state].filter(Boolean).join(", "),
    revenue: formatRevenue(col.pick(r, "annual revenue")),
    subsidiary: col.pick(r, "subsidiary of"),
  };
}

function makeColPicker(headers) {
  return {
    pick(r, ...names) {
      for (const n of names) {
        const idx = headers.indexOf(n);
        if (idx !== -1 && (r[idx] || "").trim()) return r[idx].trim();
      }
      return "";
    },
  };
}

function mapApolloPeople(rows) {
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = makeColPicker(headers);
  return rows.slice(1).map((r) => ({
    name:
      col.pick(r, "name", "full name") ||
      [col.pick(r, "first name"), col.pick(r, "last name")].filter(Boolean).join(" "),
    title: col.pick(r, "title", "job title", "role"),
    linkedin: col.pick(r, "person linkedin url", "linkedin url", "linkedin"),
    email: col.pick(r, "email", "email address", "work email", "secondary email"),
    phone: cleanPhone(
      col.pick(r, "mobile phone", "work direct phone", "corporate phone", "other phone", "home phone", "phone")
    ),
    company: companyFromApollo(r, col),
  }));
}

function mapApolloCompanies(rows) {
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = makeColPicker(headers);
  return rows.slice(1).map((r) => companyFromApollo(r, col));
}

/* ---------- Immutable tree helpers ---------- */

function mapNode(node, id, fn) {
  if (node.id === id) return fn(node);
  if (!node.children?.length) return node;
  return { ...node, children: node.children.map((c) => mapNode(c, id, fn)) };
}

function mapTree(funds, id, fn) {
  return funds.map((f) => mapNode(f, id, fn));
}

function dropNode(node, id) {
  if (!node.children?.length) return node;
  return {
    ...node,
    children: node.children.filter((c) => c.id !== id).map((c) => dropNode(c, id)),
  };
}

/* ---------- Small pieces ---------- */

function hrefFor(kind, value) {
  const v = (value || "").trim();
  if (!v) return null;
  if (kind === "url") return /^https?:\/\//i.test(v) ? v : `https://${v}`;
  if (kind === "email") return `mailto:${v}`;
  if (kind === "tel") return `tel:${v.replace(/[^+\d]/g, "")}`;
  return null;
}

// An editable field with a small ↗ that opens the value as a link.
function LinkableInput({ linkKind, value, ...props }) {
  const href = linkKind ? hrefFor(linkKind, value) : null;
  return (
    <div className="linkable">
      <input value={value} {...props} />
      {href && (
        <a
          className="goto"
          href={href}
          target={linkKind === "url" ? "_blank" : undefined}
          rel="noreferrer"
          tabIndex={-1}
          title={`Open ${value}`}
        >
          ↗
        </a>
      )}
    </div>
  );
}

function countContacts(node) {
  return node.contacts.length + node.children.reduce((sum, c) => sum + countContacts(c), 0);
}

function stageClass(stage) {
  return `stage-${Math.min(5, Math.max(1, Number(stage) || 1))}`;
}

function respClass(response) {
  switch (response) {
    case "Yes": return "resp-yes";
    case "No": return "resp-no";
    case "Follow up": return "resp-follow";
    case "Wrong info": return "resp-wrong";
    default: return "resp-none";
  }
}

function InfoBar({ entity, onEdit, onSave }) {
  const fields = [
    ["linkedin", "LinkedIn"],
    ["website", "Website"],
    ["location", "Location"],
    ["revenue", "Revenue"],
  ];
  return (
    <div className="info-bar">
      {fields.map(([key, label]) => (
        <div className="info-field" key={key}>
          <label>{label}</label>
          <LinkableInput
            linkKind={key === "linkedin" || key === "website" ? "url" : null}
            value={entity[key] || ""}
            placeholder={label}
            onChange={(e) => onEdit({ [key]: e.target.value })}
            onBlur={(e) => onSave({ [key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

function ContactsTable({ entity, api }) {
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const contacts = mapApolloRows(parseCSV(text));
    if (contacts.length === 0) {
      alert("Couldn't find any contacts in that CSV — check that it has a header row.");
      return;
    }
    api.importContacts(entity.id, contacts);
  };

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "15%" }}>Name</th>
              <th style={{ width: "15%" }}>Role</th>
              <th style={{ width: "17%" }}>LinkedIn</th>
              <th style={{ width: "17%" }}>Email</th>
              <th style={{ width: "12%" }}>Phone</th>
              <th>Stage</th>
              <th>Response</th>
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {entity.contacts.length === 0 && (
              <tr>
                <td className="empty-row" colSpan={8}>
                  No contacts yet — add one or upload an Apollo CSV.
                </td>
              </tr>
            )}
            {entity.contacts.map((c) => (
              <tr key={c.id}>
                {[
                  ["name", null],
                  ["title", null],
                  ["linkedin", "url"],
                  ["email", "email"],
                  ["phone", "tel"],
                ].map(([key, linkKind]) => (
                  <td key={key}>
                    <LinkableInput
                      linkKind={linkKind}
                      value={c[key] || ""}
                      onChange={(e) => api.editContact(entity.id, c.id, { [key]: e.target.value })}
                      onBlur={(e) => api.saveContact(c.id, { [key]: e.target.value })}
                    />
                  </td>
                ))}
                <td>
                  <select
                    className={stageClass(c.stage)}
                    value={c.stage}
                    onChange={(e) => {
                      api.editContact(entity.id, c.id, { stage: Number(e.target.value) });
                      api.saveContact(c.id, { stage: Number(e.target.value) });
                    }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>Stage {n}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className={respClass(c.response)}
                    value={c.response}
                    onChange={(e) => {
                      api.editContact(entity.id, c.id, { response: e.target.value });
                      api.saveContact(c.id, { response: e.target.value });
                    }}
                  >
                    {RESPONSES.map((r) => (
                      <option key={r} value={r}>{r === "" ? "—" : r}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    className="row-delete"
                    title="Delete contact"
                    onClick={() => api.deleteContact(entity.id, c.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => api.addContact(entity.id)}>+ Add contact</button>
        <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Upload Apollo CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={handleFile} />
      </div>
    </>
  );
}

function EntitySection({ entity, api }) {
  const childKind = CHILD_KIND[entity.kind];
  return (
    <div className={`section ${entity.kind}`}>
      <div className={`eyebrow ${entity.kind}`}>{KIND_LABEL[entity.kind]}</div>
      <div className="section-head">
        <input
          className="entity-name"
          value={entity.name}
          placeholder={`${KIND_LABEL[entity.kind]} name`}
          onChange={(e) => api.editEntity(entity.id, { name: e.target.value })}
          onBlur={(e) => api.saveEntity(entity.id, { name: e.target.value })}
        />
        <button
          className="delete-btn"
          title={`Delete ${KIND_LABEL[entity.kind]}`}
          onClick={() => api.deleteEntity(entity)}
        >
          ✕
        </button>
      </div>
      <InfoBar
        entity={entity}
        onEdit={(fields) => api.editEntity(entity.id, fields)}
        onSave={(fields) => api.saveEntity(entity.id, fields)}
      />
      <ContactsTable entity={entity} api={api} />
      {childKind && (
        <div className="children-block">
          {entity.children.map((child) => (
            <EntitySection key={child.id} entity={child} api={api} />
          ))}
          <button
            className={`btn ${childKind === "platform" ? "platform-btn" : "brand-btn"}`}
            onClick={() => api.addEntity(childKind, entity.id)}
          >
            + Add {KIND_LABEL[childKind].toLowerCase()}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Page ---------- */

export default function Home() {
  const [funds, setFunds] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [dbMessage, setDbMessage] = useState(null);
  const [status, setStatus] = useState("");
  const pending = useRef(0);
  const structureFileRef = useRef(null);

  const loadTree = () =>
    fetch("/api/tree")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setDbMessage(data.message || "Something went wrong loading the data.");
          return;
        }
        setFunds(data.funds);
        setSelectedId((sel) =>
          data.funds.some((f) => f.id === sel) ? sel : data.funds[0]?.id ?? null
        );
      })
      .catch(() => setDbMessage("Couldn't reach the server — try refreshing."));

  useEffect(() => {
    loadTree();
  }, []);

  const track = async (promise) => {
    pending.current++;
    setStatus("saving");
    try {
      const res = await promise;
      if (!res.ok) throw new Error("save failed");
      return res;
    } catch (err) {
      setStatus("error");
      throw err;
    } finally {
      pending.current--;
      if (pending.current === 0) {
        setStatus((s) => (s === "error" ? "error" : "saved"));
        setTimeout(() => setStatus((s) => (s === "saved" ? "" : s)), 1500);
      }
    }
  };

  const api = {
    editEntity: (id, fields) =>
      setFunds((f) => mapTree(f, id, (n) => ({ ...n, ...fields }))),

    saveEntity: (id, fields) =>
      track(
        fetch("/api/entities", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...fields }),
        })
      ).catch(() => {}),

    addEntity: async (kind, parentId = null) => {
      try {
        const res = await track(
          fetch("/api/entities", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, parentId, name: `New ${KIND_LABEL[kind].toLowerCase()}` }),
          })
        );
        const row = await res.json();
        const node = { ...row, contacts: [], children: [] };
        if (kind === "fund") {
          setFunds((f) => [...f, node]);
          setSelectedId(node.id);
        } else {
          setFunds((f) => mapTree(f, parentId, (n) => ({ ...n, children: [...n.children, node] })));
        }
      } catch {}
    },

    deleteEntity: async (entity) => {
      const label = KIND_LABEL[entity.kind].toLowerCase();
      if (!confirm(`Delete ${label} "${entity.name}" and everything inside it?`)) return;
      try {
        await track(fetch(`/api/entities?id=${entity.id}`, { method: "DELETE" }));
        if (entity.kind === "fund") {
          setFunds((f) => {
            const next = f.filter((x) => x.id !== entity.id);
            setSelectedId((sel) => (sel === entity.id ? next[0]?.id ?? null : sel));
            return next;
          });
        } else {
          setFunds((f) => f.map((fund) => dropNode(fund, entity.id)));
        }
      } catch {}
    },

    editContact: (entityId, contactId, fields) =>
      setFunds((f) =>
        mapTree(f, entityId, (n) => ({
          ...n,
          contacts: n.contacts.map((c) => (c.id === contactId ? { ...c, ...fields } : c)),
        }))
      ),

    saveContact: (id, fields) =>
      track(
        fetch("/api/contacts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...fields }),
        })
      ).catch(() => {}),

    addContact: async (entityId) => {
      try {
        const res = await track(
          fetch("/api/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entityId, contacts: [{}] }),
          })
        );
        const { contacts } = await res.json();
        setFunds((f) =>
          mapTree(f, entityId, (n) => ({ ...n, contacts: [...n.contacts, ...contacts] }))
        );
      } catch {}
    },

    importContacts: async (entityId, rows) => {
      try {
        const res = await track(
          fetch("/api/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entityId, contacts: rows }),
          })
        );
        const { contacts } = await res.json();
        setFunds((f) =>
          mapTree(f, entityId, (n) => ({ ...n, contacts: [...n.contacts, ...contacts] }))
        );
      } catch {}
    },

    importFile: async (file) => {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length < 2) {
        alert("That CSV looks empty — it needs a header row plus data.");
        return;
      }
      const headers = parsed[0].map((h) => h.trim().toLowerCase());
      const csvKind = detectCSVKind(headers);
      try {
        if (csvKind === "structure") {
          const rows = mapStructureRows(parsed);
          const res = await track(
            fetch("/api/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rows }),
            })
          );
          const { created, updated, skipped } = await res.json();
          await loadTree();
          alert(
            `Structure file: imported ${created.fund} funds, ${created.platform} platforms, ${created.brand} brands.` +
              (updated ? ` Updated ${updated} existing.` : "") +
              (skipped ? ` Skipped ${skipped} rows (missing name or type).` : "")
          );
        } else if (csvKind === "people" || csvKind === "companies") {
          const rows = csvKind === "people" ? mapApolloPeople(parsed) : mapApolloCompanies(parsed);
          const res = await track(
            fetch("/api/smart-import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ kind: csvKind, rows }),
            })
          );
          const s = await res.json();
          await loadTree();
          const parts = [
            csvKind === "people" ? "Contacts file:" : "Companies file:",
            `matched ${s.companiesMatched} companies`,
            s.companiesCreated ? `created ${s.companiesCreated} new` : "",
            s.companiesUpdated ? `filled in info on ${s.companiesUpdated}` : "",
            csvKind === "people" ? `added ${s.contactsAdded} contacts` : "",
            s.contactsSkipped ? `skipped ${s.contactsSkipped} duplicates` : "",
            s.rowsSkipped ? `skipped ${s.rowsSkipped} unusable rows` : "",
          ].filter(Boolean);
          alert(parts.join(", ") + ".");
        } else {
          alert(
            "Couldn't recognize this CSV. Supported: a structure file (Type/Sponsor/Platform columns), an Apollo people export, or an Apollo accounts export."
          );
        }
      } catch {
        alert("Import failed — check the file and try again.");
      }
    },

    deleteContact: async (entityId, contactId) => {
      try {
        await track(fetch(`/api/contacts?id=${contactId}`, { method: "DELETE" }));
        setFunds((f) =>
          mapTree(f, entityId, (n) => ({
            ...n,
            contacts: n.contacts.filter((c) => c.id !== contactId),
          }))
        );
      } catch {}
    },
  };

  if (dbMessage) {
    return (
      <div className="center-note">
        <h2>Not connected yet</h2>
        <p>{dbMessage}</p>
        <p style={{ marginTop: 10 }}>
          Once the database exists, run <code>schema.sql</code> in the Neon SQL Editor, then
          redeploy.
        </p>
      </div>
    );
  }

  if (!funds) {
    return <div className="center-note"><p>Loading…</p></div>;
  }

  const selected = funds.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h1>Arch CRM</h1>
          <p>PE outbound tracker</p>
        </div>
        <div className="sidebar-list">
          {funds.map((f) => (
            <button
              key={f.id}
              className={`fund-item ${f.id === selectedId ? "active" : ""}`}
              onClick={() => setSelectedId(f.id)}
            >
              <span className="fund-dot" />
              <span className="fund-label">{f.name || "Untitled fund"}</span>
              <span className="fund-count">{countContacts(f)}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-foot">
          <button className="btn primary" onClick={() => api.addEntity("fund")}>
            + Add PE fund
          </button>
          <button className="btn" onClick={() => structureFileRef.current?.click()}>
            ⬆ Import any CSV
          </button>
          <input
            ref={structureFileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) api.importFile(file);
            }}
          />
          <a className="btn" href="/api/export" style={{ justifyContent: "center", textDecoration: "none" }}>
            ⬇ Export all (CSV)
          </a>
        </div>
      </aside>

      <main className="main">
        {selected ? (
          <EntitySection entity={selected} api={api} />
        ) : (
          <div className="center-note">
            <h2>No funds yet</h2>
            <p>Add your first PE fund from the sidebar to get started.</p>
          </div>
        )}
      </main>

      {status && (
        <div className={`save-indicator ${status === "error" ? "error" : ""}`}>
          {status === "saving" ? "Saving…" : status === "error" ? "Save failed — retry your edit" : "Saved ✓"}
        </div>
      )}
    </div>
  );
}
