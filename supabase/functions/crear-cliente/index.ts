// Da de alta a un cliente del portal y le manda la invitación por correo.
// Solo la puede usar un administrador de AbyC (se revisa su perfil).
// La llave secreta vive en Supabase; nunca llega al navegador.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Llave secreta: primero el sistema nuevo (SUPABASE_SECRET_KEYS), luego la antigua
function llaveSecreta(): string {
  const nuevas = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (nuevas) {
    try {
      const d = JSON.parse(nuevas);
      const v = d.default ?? Object.values(d)[0];
      if (typeof v === "string" && v) return v;
    } catch { /* sigue con la antigua */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, llaveSecreta(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ¿Quién llama? Debe tener sesión y ser admin.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sesión no válida" }, 401);
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json({ error: "Sesión no válida" }, 401);
  const { data: perfil } = await admin.from("perfiles").select("rol").eq("id", user.id).single();
  if (perfil?.rol !== "admin") return json({ error: "Solo un administrador puede dar de alta clientes" }, 403);

  let body: { nombre_cliente?: string; nombre_contacto?: string; correo?: string; cliente_id?: string; redirect?: string };
  try { body = await req.json(); } catch { return json({ error: "Datos no válidos" }, 400); }

  const correo = (body.correo ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return json({ error: "Correo no válido" }, 400);

  // Cliente nuevo o usuario extra de un cliente que ya existe
  let clienteId = body.cliente_id ?? null;
  if (!clienteId) {
    const nombre = (body.nombre_cliente ?? "").trim();
    if (!nombre) return json({ error: "Falta el nombre del cliente" }, 400);
    const { data, error } = await admin.from("clientes").insert({ nombre }).select("id").single();
    if (error) return json({ error: error.message }, 400);
    clienteId = data.id;
  }

  // Solo se permite redirigir a nuestro propio sitio (o a localhost para pruebas)
  const redirect = body.redirect && /^(https:\/\/abycagency\.com|http:\/\/localhost:\d+)\//.test(body.redirect)
    ? body.redirect
    : "https://abycagency.com/clientes/nueva-contrasena/";

  const { error } = await admin.auth.admin.inviteUserByEmail(correo, {
    data: { cliente_id: clienteId, nombre: (body.nombre_contacto ?? "").trim() },
    redirectTo: redirect,
  });
  if (error) return json({ error: error.message, cliente_id: clienteId }, 400);

  return json({ ok: true, cliente_id: clienteId });
});
