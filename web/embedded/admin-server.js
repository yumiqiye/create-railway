/*
 * 清江铁路 12306 后台静态服务（模组内嵌版，无第三方依赖）。
 * 负责托管 web/admin/dist 构建产物，并把 /api/* 转发到本机票务后端。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const TICKET_PORT = Number(process.env.TICKET_PORT || 3000);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 8001);
const DIST_DIR = path.join(__dirname, 'admin', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const resolved = path.resolve(DIST_DIR, rel.replace(/^([/\\])+/, ''));
  if (!resolved.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(resolved, (err, stat) => {
    if (!err && stat.isFile()) {
      sendFile(res, resolved);
      return;
    }
    // 前端单页应用路由回退到 index.html。
    sendFile(res, path.join(DIST_DIR, 'index.html'));
  });
}

function proxyApi(req, res, urlPath) {
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: TICKET_PORT,
      path: urlPath,
      method: req.method,
      headers: req.headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 502, result: null, message: '票务后端未启动' }));
  });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
    proxyApi(req, res, req.url);
    return;
  }
  serveStatic(req, res, url.pathname);
}).listen(ADMIN_PORT, '127.0.0.1', () => {
  console.log(`[railway-plus] admin static server listening on 127.0.0.1:${ADMIN_PORT}`);
});
