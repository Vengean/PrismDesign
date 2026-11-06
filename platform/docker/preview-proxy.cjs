// One published container entry point for dynamically discovered HTTP services.
const http = require('node:http');
const net = require('node:net');
const {chooseService, readJson, startMonitor} = require('./runtime-health.cjs');
function createPreviewProxy({services = () => readJson('/var/log/prism/health.json', {}).services || [], hostname = port => require('./runtime-health.cjs').listeners().find(s => s.port === port)?.hostname || '127.0.0.1', timeout = 30000} = {}) {
  function target(req) {
    const raw = req.headers['x-prism-service-port'];
    return chooseService(services(), raw === undefined ? undefined : Number(raw));
  }
  function headers(req, port) { const h = {...req.headers, host: `localhost:${port}`}; delete h['x-prism-service-port']; return h; }
  const server = http.createServer((req, res) => {
    const port = target(req);
    if (!port) { res.writeHead(503, {'Content-Type': 'text/plain; charset=utf-8'}); res.end('HTTP 服务尚未就绪，或存在多个服务，请从平台选择预览服务。'); return; }
    const upstream = http.request({hostname: hostname(port), port, path: req.url, method: req.method, headers: headers(req, port)}, response => {
      clearTimeout(timer);
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
      response.on('error', () => res.destroy());
    });
    const timer = setTimeout(() => { upstream.destroy(Object.assign(Error('timeout'), {code: 'ETIMEDOUT'})); }, timeout);
    upstream.setTimeout(timeout, () => upstream.destroy(Object.assign(Error('timeout'), {code: 'ETIMEDOUT'})));
    upstream.on('error', error => {
      clearTimeout(timer);
      if (res.headersSent) { res.destroy(); return; }
      const timedOut = error.code === 'ETIMEDOUT';
      res.writeHead(timedOut ? 504 : 502, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end(timedOut ? '业务服务响应超时，请查看启动日志。' : error.code?.startsWith('HPE_') ? '目标端口未返回有效 HTTP 响应，请检查服务协议。' : '业务服务连接失败，请查看启动日志。');
    });
    req.pipe(upstream); res.on('close', () => { clearTimeout(timer); upstream.destroy(); });
  });
  server.on('upgrade', (req, socket, head) => {
    const port = target(req); if (!port) return socket.destroy();
    const timer = setTimeout(() => { upstream.destroy(); socket.destroy(); }, timeout);
    const upstream = net.connect(port, hostname(port), () => {
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers(req, port)).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      upstream.write(head); socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.once('data', () => clearTimeout(timer));
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    socket.on('close', () => { clearTimeout(timer); upstream.destroy(); });
  });
  return server;
}
module.exports = {createPreviewProxy};
if (require.main === module) { startMonitor(); createPreviewProxy().listen(8090, '0.0.0.0'); }
