// Bridge Vercel -> MikroTik (RouterOS v7 REST API)
// Menerima POST dari portal, membuat user hotspot di router.
const https = require('https');
const http = require('http');

// Website yang boleh memakai bridge. Tambah alamat baru di daftar ini,
// atau isi Environment Variable ALLOWED_ORIGIN (boleh beberapa, pisahkan koma).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .concat([
    'https://portal-resapi-appnet.netlify.app',
    'https://app-wiljum.netlify.app',
  'https://coffe-fariz.netlify.app',
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function callRouter({ host, port, scheme, user, pass, method, path, body }) {
  return new Promise((resolve, reject) => {
    const lib = scheme === 'http' ? http : https;
    const data = body ? JSON.stringify(body) : null;
    const options = {
      host,
      port,
      path,
      method,
      timeout: 15000,
      rejectUnauthorized: false, // sertifikat router biasanya self-signed
      headers: {
        Authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64'),
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const r = lib.request(options, (resp) => {
      let text = '';
      resp.on('data', (c) => (text += c));
      resp.on('end', () => resolve({ status: resp.statusCode, text }));
    });
    r.on('timeout', () => r.destroy(new Error('Timeout: router tidak menjawab dalam 15 detik')));
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, pesan: 'Bridge MikroTik aktif' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method tidak diizinkan' });
  }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};

  const { tunnelHost, tunnelUser, tunnelPass, username, password, profile, comment } = b;
  if (!tunnelHost || !tunnelUser || !tunnelPass || !username || !profile) {
    return res.status(400).json({ ok: false, error: 'Data kurang: host, user, pass router, username, dan profile wajib diisi' });
  }

  // Port & skema bisa diatur lewat Environment Variable di Vercel
  const port = parseInt(b.tunnelPort || process.env.ROUTER_PORT || '443', 10);
  const scheme = (b.tunnelScheme || process.env.ROUTER_SCHEME || 'https').toLowerCase();

  try {
    const r = await callRouter({
      host: tunnelHost, port, scheme,
      user: tunnelUser, pass: tunnelPass,
      method: 'PUT',
      path: '/rest/ip/hotspot/user',
      body: {
        name: String(username),
        password: String(password || username),
        profile: String(profile),
        comment: String(comment || '')
      }
    });

    if (r.status >= 200 && r.status < 300) {
      return res.status(200).json({ ok: true, pesan: 'User hotspot dibuat di router', router: safeJson(r.text) });
    }
    return res.status(502).json({
      ok: false,
      error: 'Router menolak (HTTP ' + r.status + '): ' + pesanRouter(r.text)
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Gagal terhubung ke router: ' + err.message });
  }
};

function safeJson(t) { try { return JSON.parse(t); } catch (e) { return t; } }
function pesanRouter(t) {
  const j = safeJson(t);
  if (j && typeof j === 'object') return j.detail || j.message || j.error || JSON.stringify(j);
  return String(t).slice(0, 300);
}
