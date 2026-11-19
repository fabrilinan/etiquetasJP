import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

// Diseños guardados en la nube. Clave: "<espacio>/<id>".
const OK_E = /^[a-z0-9-]{1,40}$/;
const OK_ID = /^[a-z0-9]{6,24}$/;
const MAX = 5_800_000; // límite práctico del cuerpo (las funciones aceptan hasta 6 MB)

const store = () => getStore({ name: "disenos", consistency: "strong" });
const json = (d: unknown, status = 200) =>
  Response.json(d, { status, headers: { "cache-control": "no-store" } });
const txt = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const e = (url.searchParams.get("e") || "equipo").toLowerCase();
  if (!OK_E.test(e)) return json({ error: "Espacio inválido" }, 400);
  const id = context.params?.id;
  const st = store();

  try {
    // Lista de diseños del espacio
    if (!id) {
      if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
      const { blobs } = await st.list({ prefix: `${e}/` });
      const items = (
        await Promise.all(
          blobs.map(async (b) => {
            const m = await st.getMetadata(b.key);
            return m === null ? null : { id: b.key.slice(e.length + 1), ...(m.metadata || {}) };
          })
        )
      ).filter(Boolean) as Array<Record<string, unknown>>;
      items.sort((a, b) => Number(b.updated || 0) - Number(a.updated || 0));
      return json({ items });
    }

    if (!OK_ID.test(id)) return json({ error: "ID inválido" }, 400);
    const key = `${e}/${id}`;

    if (req.method === "GET") {
      const d = await st.get(key, { type: "text" });
      if (d === null) return json({ error: "Ese diseño ya no existe" }, 404);
      return new Response(d, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > MAX) return json({ error: "El diseño es muy pesado" }, 413);
      let d: any;
      try { d = JSON.parse(body); } catch { return json({ error: "JSON inválido" }, 400); }
      if (!d || d.app !== "etiquetas" || !d.S) return json({ error: "No es un diseño de etiquetas" }, 400);
      const S = d.S;
      const meta = {
        name: txt(d.name || S.t1 || "Sin título", 60),
        w: Number(S.W) || 0,
        h: Number(S.H) || 0,
        fold: !!Number(S.fold),
        bg: txt(S.bg, 9), tx: txt(S.tx, 9), a1: txt(S.a1, 9), a2: txt(S.a2, 9),
        items: Array.isArray(d.items) ? d.items.length : 0,
        updated: Date.now(),
      };
      await st.set(key, body, { metadata: meta });
      return json({ ok: true, id, ...meta });
    }

    if (req.method === "DELETE") {
      await st.delete(key);
      return json({ ok: true });
    }

    return json({ error: "Método no permitido" }, 405);
  } catch (err) {
    console.error("disenos", err);
    return json({ error: "Error del servidor" }, 500);
  }
};

export const config: Config = {
  path: ["/api/disenos", "/api/disenos/:id"],
};
