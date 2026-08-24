// Genera el índice del blog, el sitemap y la parte de artículos de llms.txt
// leyendo los propios artículos.
//
// Antes esas tres cosas se mantenían a mano, y cada artículo nuevo obligaba a
// tocar cuatro archivos: era cuestión de tiempo que uno se quedara sin
// aparecer en el sitemap o con la fecha equivocada.
//
// Cada artículo se describe a sí mismo con etiquetas <meta name="abyc:...">
// en su cabeza. Para publicar uno nuevo basta escribirlo con esas etiquetas y
// correr:
//
//     node generar.js
//
// Uso: desde la raíz del repositorio.

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = __dirname;
const BLOG = path.join(RAIZ, 'blog');
const SITIO = 'https://abycagency.com';

// ---------- leer lo que cada artículo dice de sí mismo ----------
function meta(t, nombre) {
  const m = t.match(new RegExp(`<meta name="${nombre}" content="([^"]*)"`));
  return m ? m[1] : '';
}

const articulos = fs.readdirSync(BLOG)
  .filter(f => f.endsWith('.html') && f !== 'index.html')
  .map(f => {
    const t = fs.readFileSync(path.join(BLOG, f), 'utf8');
    return {
      archivo: f,
      slug: f.replace('.html', ''),
      titulo: ((t.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').replace(/<[^>]+>/g, '').trim(),
      descripcion: meta(t, 'description'),
      familia: meta(t, 'abyc:familia') || 'estrategia',
      concepto: meta(t, 'abyc:concepto') || '',
      disciplina: meta(t, 'abyc:disciplina') || '',
      etiquetas: (meta(t, 'abyc:etiquetas') || '').split('|').filter(Boolean),
      fecha: meta(t, 'abyc:fecha') || (t.match(/"datePublished":\s*"([^"]+)"/) || [])[1] || '',
    };
  })
  .filter(a => a.titulo)
  // más recientes primero; a igual fecha, orden alfabético estable
  .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.slug.localeCompare(b.slug));

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function enPalabras(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}
function escapar(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- índice del blog ----------
const piezas = articulos.map((a, i) => `
  <a class="pieza" href="/blog/${a.archivo}">
    <div class="portada c-${a.familia}">
      <div><span class="disciplina">${a.disciplina}</span><p class="concepto">${a.concepto}</p></div>
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
    </div>
    <div class="etiquetas">${a.etiquetas.map(e => `<span class="etiqueta">${e}</span>`).join('')}</div>
    <h2>${escapar(a.titulo)}</h2>
    <time datetime="${a.fecha}">${enPalabras(a.fecha)}</time>
  </a>`).join('\n');

const listaLd = articulos.map(a => `    { "@type": "BlogPosting", "headline": ${JSON.stringify(a.titulo)}, "url": "${SITIO}/blog/${a.archivo}", "datePublished": "${a.fecha}", "description": ${JSON.stringify(a.descripcion)} }`).join(',\n');

let indice = fs.readFileSync(path.join(BLOG, 'index.html'), 'utf8');

indice = indice.replace(/(<main class="rejilla">)[\s\S]*?(<\/main>)/, `$1\n${piezas}\n\n$2`);
indice = indice.replace(/("blogPost":\s*\[)[\s\S]*?(\n\s*\])/, `$1\n${listaLd}$2`);
indice = indice.replace(/(Ver los )[a-zé]+( artículos)/, `$1${articulos.length}$2`);

fs.writeFileSync(path.join(BLOG, 'index.html'), indice, 'utf8');

// ---------- sitemap ----------
const hoy = new Date().toISOString().slice(0, 10);
// Las páginas de servicio se descubren solas: son las que están en la raíz y
// no son el inicio ni el autor. Así, una página nueva entra al sitemap sin
// que haya que acordarse de anotarla aquí.
const servicios = fs.readdirSync(RAIZ)
  .filter(f => f.endsWith('.html') && !['index.html', 'servicios.html', 'adan-limones-ambriz.html'].includes(f));

const fijas = [
  { loc: `${SITIO}/`, fecha: hoy, freq: 'weekly', pri: '1.0' },
  // Los servicios van con prioridad alta: son las páginas que atienden a
  // quien está buscando contratar, no a quien está leyendo.
  { loc: `${SITIO}/servicios.html`, fecha: hoy, freq: 'monthly', pri: '0.9' },
  ...servicios.map(f => ({ loc: `${SITIO}/${f}`, fecha: hoy, freq: 'monthly', pri: '0.9' })),
  { loc: `${SITIO}/adan-limones-ambriz.html`, fecha: hoy, freq: 'monthly', pri: '0.8' },
  { loc: `${SITIO}/blog/`, fecha: articulos[0].fecha, freq: 'weekly', pri: '0.8' },
];
const urls = [
  ...fijas,
  ...articulos.map(a => ({ loc: `${SITIO}/blog/${a.archivo}`, fecha: a.fecha, freq: 'monthly', pri: '0.7' })),
];
fs.writeFileSync(path.join(RAIZ, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(u => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.fecha}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`).join('\n') +
  '\n</urlset>\n', 'utf8');

// ---------- llms.txt ----------
let llms = fs.readFileSync(path.join(RAIZ, 'llms.txt'), 'utf8');
const lista = articulos.map(a => `- [${a.titulo}](${SITIO}/blog/${a.archivo}): ${a.descripcion}`).join('\n');
llms = llms.replace(/(uno explica un sesgo o mecanismo concreto y cómo se aplica al marketing\.\n\n)[\s\S]*?(\n\n## )/, `$1${lista}$2`);
fs.writeFileSync(path.join(RAIZ, 'llms.txt'), llms, 'utf8');

// ---------- resumen ----------
console.log(`artículos: ${articulos.length}`);
const porFamilia = {};
articulos.forEach(a => porFamilia[a.familia] = (porFamilia[a.familia] || 0) + 1);
console.log('por familia: ' + Object.entries(porFamilia).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(`sitemap: ${urls.length} direcciones`);
console.log(`llms.txt: ${(llms.match(/^- \[/gm) || []).length} artículos listados`);
