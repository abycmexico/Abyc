// Utilidades compartidas del portal de clientes de AbyC.
(function () {
  const cfg = window.ABYC_PORTAL || {};
  const listo = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY;

  const sb = listo
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  // Raíz del portal: funciona igual en abycagency.com y en localhost
  const base = location.pathname.replace(/\/clientes\/.*$/, '') + '/clientes/';
  const url = (p) => location.origin + base + (p || '');

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fecha = (d, op) => d
    ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d)
        .toLocaleDateString('es-MX', op || { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const mes = (d) => fecha(d, { month: 'long', year: 'numeric' });

  function aviso(el, texto, tipo) {
    if (!el) return;
    el.className = 'msg ' + (tipo || 'ok');
    el.textContent = texto;
    el.classList.remove('oculto');
  }

  function sinConfig() {
    document.body.innerHTML =
      '<div class="centro"><div class="card"><h2>Portal en preparación</h2>' +
      '<p class="sub">Falta conectar el portal con su base de datos.</p></div></div>';
  }

  // Exige sesión; regresa { user, perfil } o manda al login
  async function sesion() {
    if (!sb) { sinConfig(); return null; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = url(''); return null; }
    const { data: perfil } = await sb.from('perfiles').select('*').eq('id', session.user.id).single();
    return { user: session.user, perfil: perfil || {} };
  }

  async function salir() {
    if (sb) await sb.auth.signOut();
    location.href = url('');
  }

  // Abre un archivo privado con un enlace temporal de 2 minutos
  async function descargar(ruta, nombre) {
    const { data, error } = await sb.storage.from('portal')
      .createSignedUrl(ruta, 120, nombre ? { download: nombre } : undefined);
    if (error) { alert('No se pudo abrir el archivo. Intenta de nuevo.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  const nombreSeguro = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').toLowerCase();

  window.Portal = { sb, url, esc, fecha, mes, aviso, sesion, salir, descargar, nombreSeguro, listo };
})();
