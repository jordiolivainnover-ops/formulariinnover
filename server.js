import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { MONDAY_API_TOKEN, BOARD_OBRES_ID, BOARD_VISITES_ID, APP_USER = "visites", APP_PASSWORD, PORT = 3000 } = process.env;

for (const [k, v] of Object.entries({ MONDAY_API_TOKEN, BOARD_OBRES_ID, BOARD_VISITES_ID })) {
  if (!v) console.error(`Falta la variable d'entorn ${k}`);
}
if (!APP_PASSWORD) console.warn("APP_PASSWORD no definida: l'aplicació queda oberta a tothom. Defineix-la a Render.");

const app = express();
app.disable("x-powered-by");

// Comprovació de salut per a Render (abans de l'autenticació)
app.get("/healthz", (_req, res) => res.send("ok"));

// Autenticació bàsica amb usuari i contrasenya compartits
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const [type, value] = (req.headers.authorization || "").split(" ");
    if (type === "Basic" && value) {
      const [user, ...rest] = Buffer.from(value, "base64").toString().split(":");
      if (same(user, APP_USER) && same(rest.join(":"), APP_PASSWORD)) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Visites d\'obra"').status(401).send("Cal autenticació");
  });
}

app.use(express.static(path.join(__dirname, "public")));

// ---------- monday ----------
async function gql(query, variables) {
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: MONDAY_API_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error("monday: " + JSON.stringify(j.errors || j.error_message || r.status));
  return j.data;
}

async function uploadFile(itemId, columnId, filename, buffer) {
  if (!/^[\w]+$/.test(columnId) || !/^\d+$/.test(String(itemId))) throw new Error("Identificadors no vàlids");
  const fd = new FormData();
  fd.append("query", `mutation($file: File!){ add_file_to_column(item_id: ${itemId}, column_id: "${columnId}", file: $file){ id } }`);
  fd.append("variables[file]", new Blob([buffer], { type: "application/pdf" }), filename);
  const r = await fetch("https://api.monday.com/v2/file", { method: "POST", headers: { Authorization: MONDAY_API_TOKEN }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error("monday (fitxer): " + JSON.stringify(j.errors || r.status));
}

// Llista d'obres (tauler d'obres), amb memòria cau d'un minut
let obres = { t: 0, data: [] };
app.get("/api/obres", async (_req, res) => {
  try {
    if (Date.now() - obres.t < 60_000) return res.json(obres.data);
    const items = [];
    let page = (await gql(`query($b:[ID!]){ boards(ids:$b){ items_page(limit:500){ cursor items{ id name } } } }`, { b: [BOARD_OBRES_ID] })).boards[0].items_page;
    items.push(...page.items);
    while (page.cursor) {
      page = (await gql(`query($c:String!){ next_items_page(limit:500, cursor:$c){ cursor items{ id name } } }`, { c: page.cursor })).next_items_page;
      items.push(...page.items);
    }
    obres = { t: Date.now(), data: items.sort((a, b) => a.name.localeCompare(b.name, "ca")) };
    res.json(obres.data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Columnes del tauler de visites, localitzades pel títol
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
let cols = { t: 0, map: new Map() };
async function getColumns() {
  if (Date.now() - cols.t < 300_000) return cols.map;
  const d = await gql(`query($b:[ID!]){ boards(ids:$b){ columns{ id title type } } }`, { b: [BOARD_VISITES_ID] });
  cols = { t: Date.now(), map: new Map(d.boards[0].columns.map((c) => [norm(c.title), c])) };
  return cols.map;
}

// clau de les dades -> possibles títols de columna al tauler
const MAP = [
  ["projecte", ["Projecte", "Obra"]],
  ["ubicacio", ["Ubicació"]],
  ["data", ["Data", "Data de la visita"]],
  ["motiu", ["Motiu", "Motiu de la visita"]],
  ["enginyer", ["Enginyer/a", "Enginyer"]],
  ["cap_equip", ["Cap d'equip"]],
  ["fase", ["Fase d'obra", "Fase"]],
  ["meteo", ["Meteorologia"]],
  ["n_no_conformitats", ["Nº no conformitats", "Núm. no conformitats"]],
  ["no_conformitats", ["No conformitats"]],
  ["observacions", ["Observacions"]],
];

function format(type, v) {
  if (v === undefined || v === null || v === "") return undefined;
  switch (type) {
    case "text": return String(v);
    case "long_text": return { text: String(v) };
    case "date": return { date: String(v) };
    case "numbers": return String(v);
    case "status": return { label: String(v) };
    case "dropdown": return { labels: [String(v)] };
    case "location": {
      const m = String(v).match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
      return m ? { lat: m[1], lng: m[2], address: String(v) } : undefined;
    }
    default: return undefined;
  }
}
const fmtDate = (d) => (d ? String(d).split("-").reverse().join("/") : "");

app.post("/api/visites", express.json({ limit: "40mb" }), async (req, res) => {
  try {
    const { dades = {}, fitxer = "informe.pdf", pdf } = req.body || {};
    if (!dades.projecte) return res.status(400).json({ error: "Falta el projecte" });
    if (!pdf) return res.status(400).json({ error: "Falta el PDF" });

    const map = await getColumns();
    const values = {};
    for (const [key, titles] of MAP) {
      const col = titles.map((t) => map.get(norm(t))).find(Boolean);
      if (!col) { console.warn(`Columna no trobada per a "${key}"`); continue; }
      const v = format(col.type, dades[key]);
      if (v !== undefined) values[col.id] = v;
    }

    const name = `${dades.projecte} · ${fmtDate(dades.data)}`.trim();
    const created = await gql(
      `mutation($b:ID!,$n:String!,$v:JSON!){ create_item(board_id:$b, item_name:$n, column_values:$v, create_labels_if_missing:true){ id } }`,
      { b: BOARD_VISITES_ID, n: name, v: JSON.stringify(values) },
    );
    const itemId = created.create_item.id;

    const fileCol = map.get(norm("Informe PDF"));
    if (fileCol) {
      try {
        await uploadFile(itemId, fileCol.id, String(fitxer).replace(/[^\w.\-]+/g, "_"), Buffer.from(pdf, "base64"));
      } catch (e) {
        console.error(e);
        return res.status(502).json({ error: "La visita s'ha creat a monday, però no s'ha pogut adjuntar el PDF: " + e.message, itemId });
      }
    } else {
      console.warn('No hi ha cap columna "Informe PDF" de tipus fitxer');
    }
    res.json({ ok: true, itemId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Errors (per exemple, cos massa gran) sempre en JSON
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.type === "entity.too.large" ? "L'informe és massa gran" : err.message });
});

app.listen(PORT, () => console.log(`Escoltant al port ${PORT}`));
