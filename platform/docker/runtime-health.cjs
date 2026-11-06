// Shared by the container proxy and its readiness monitor. No credentials leave this process.
const fs = require('node:fs');
const http = require('node:http');
const ROOT = '/var/log/prism';
function listeners() {
  const values = new Map();
  for (const [file, host] of [['/proc/net/tcp', '127.0.0.1'], ['/proc/net/tcp6', '::1']]) {
    for (const line of fs.readFileSync(file, 'utf8').trim().split('\n').slice(1)) {
      const c = line.trim().split(/\s+/), port = parseInt(c[1].split(':')[1], 16);
      if (c[3] === '0A' && port > 1024 && ![8080, 8090, 9527].includes(port) && !values.has(port)) values.set(port, host);
    }
  }
  return [...values].sort(([a], [b]) => a - b).map(([port, hostname]) => ({port, hostname}));
}
function probe({port, hostname = '127.0.0.1'}, {timeout = 1500, path = '/', token, agent = false} = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve({port, ...value}); };
    const req = http.request({hostname, port, path, method: 'GET', agent: false,
      headers: {host: `localhost:${port}`, accept: 'text/html,application/json', ...(token ? {authorization: `Bearer ${token}`} : {})}}, res => {
      const statusCode = res.statusCode, contentType = String(res.headers['content-type'] || '');
      if (!agent) {
        finish({protocol: 'http', statusCode, contentType, ready: statusCode < 500, page: contentType.toLowerCase().includes('text/html')});
        res.destroy(); return;
      }
      let body = '';
      res.on('data', chunk => { body += chunk; if (body.length > 65536) res.destroy(); });
      res.on('end', () => { let ready = false; try { ready = statusCode === 200 && JSON.parse(body).status === 'running'; } catch {} finish({protocol: 'http', statusCode, ready}); });
      res.on('error', () => finish({protocol: 'http', statusCode, ready: false}));
    });
    const timer = setTimeout(() => { finish({protocol: 'timeout', ready: false}); req.destroy(); }, timeout);
    req.on('error', error => finish({protocol: error.code?.startsWith('HPE_') ? 'non-http' : 'unavailable', ready: false}));
    req.end();
  });
}
function chooseService(services, selected) {
  const ready = services.filter(s => s.protocol === 'http' && s.ready);
  if (selected !== undefined) return ready.find(s => s.port === selected)?.port;
  const pages = ready.filter(s => s.page);
  return pages.length === 1 ? pages[0].port : ready.length === 1 ? ready[0].port : undefined;
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function atomicJson(file, value) { fs.writeFileSync(file + '.tmp', JSON.stringify(value)); fs.renameSync(file + '.tmp', file); }
function evaluateHealth(phase, agentReady, services, now, unhealthySince, prepareTimeout, startupTimeout) {
  const preparing = phase.phase !== 'starting';
  const ready = !preparing && agentReady && services.some(s => s.ready && s.protocol === 'http');
  const since = ready ? undefined : unhealthySince ?? (preparing ? phase.startedAt : phase.changedAt);
  const expired = !ready && now - since >= (preparing ? prepareTimeout : startupTimeout);
  const error = expired ? (preparing ? '环境准备超时，请检查仓库与初始化日志。' : !agentReady ? 'Agent 未就绪或连接中断，请检查 Agent 日志。' : '未发现可用 HTTP 服务，请检查启动日志、业务端口及服务响应。') : '';
  return {status: ready ? 'running' : expired ? 'failed' : preparing ? 'preparing' : 'starting', unhealthySince: since, error};
}
function startMonitor() {
  let unhealthySince, lastPhase, wasReady = false;
  const prepareTimeout = positive(process.env.PRISM_PREPARE_TIMEOUT, 1800) * 1000;
  const startupTimeout = positive(process.env.PRISM_STARTUP_TIMEOUT, 120) * 1000;
  async function tick() {
    try {
      const phase = readJson(`${ROOT}/phase.json`, {phase: 'preparing', startedAt: Date.now(), changedAt: Date.now()});
      if (phase.phase !== lastPhase) { unhealthySince = undefined; lastPhase = phase.phase; }
      let services = [], agentReady = false;
      if (phase.phase === 'starting') {
        let log = ''; try { log = fs.readFileSync(`${ROOT}/agent.log`, 'utf8'); } catch {}
        const token = [...log.matchAll(/^__PRISM_AGENT_TOKEN__=([^\r\n]+)$/gm)].at(-1)?.[1]?.trim();
        const results = await Promise.all([Promise.all(listeners().map(port => probe(port))), probe({port: 9527}, {path: '/api/status', token, agent: true})]);
        services = results[0]; agentReady = results[1].ready;
      }
      const now = Date.now();
      if (wasReady && (!agentReady || !services.some(s => s.ready && s.protocol === 'http'))) unhealthySince = now;
      const result = evaluateHealth(phase, agentReady, services, now, unhealthySince, prepareTimeout, startupTimeout);
      unhealthySince = result.unhealthySince; wasReady = result.status === 'running';
      atomicJson(`${ROOT}/health.json`, {...result, phase: phase.phase, startedAt: phase.startedAt, checkedAt: now, agentReady, services, defaultPort: chooseService(services)});
      fs.writeFileSync(`${ROOT}/state`, result.status);
      if (result.status === 'failed') {
        fs.writeFileSync(`${ROOT}/error`, result.error);
        console.error(result.error);
        try { fs.appendFileSync(`/proc/${process.ppid}/fd/1`, `__PRISM_RUNTIME_ERROR__=${result.error}\n`); } catch {}
        // Stop bootstrap/services through PID 1; the persistent code volume is untouched.
        process.kill(process.ppid, 'SIGKILL'); return;
      }
    } catch (error) { console.error('健康检查失败:', error.message); }
    setTimeout(tick, 2000);
  }
  void tick();
}
function positive(value, fallback) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
module.exports = {listeners, probe, chooseService, evaluateHealth, startMonitor, readJson};
if (require.main === module) {
  const phase = process.argv[2];
  if (!['preparing', 'initializing', 'starting'].includes(phase)) throw Error('Invalid runtime phase');
  const now = Date.now(), previous = readJson(`${ROOT}/phase.json`, {});
  atomicJson(`${ROOT}/phase.json`, {phase, startedAt: previous.startedAt || now, changedAt: now});
}
