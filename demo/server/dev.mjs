import { spawn } from 'node:child_process'
import net from 'node:net'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = new Set()
let apiRestartTimer
let stopping = false
const apiPort = Number(process.env.PRISM_API_PORT || 3001)

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', (error) => resolve(error.code !== 'EADDRINUSE'))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '0.0.0.0')
  })
}

function stopChild(child) {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
  } catch {
    try { child.kill('SIGTERM') } catch {}
  }
}

function startApi() {
  const child = spawn(pnpm, ['exec', 'tsx', 'watch', 'server/index.ts'], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  })
  children.add(child)
  child.on('exit', (code, signal) => {
    children.delete(child)
    if (stopping) return
    console.error(`[Prism Demo] API 进程退出 (${signal || code})，500ms 后仅重启 API`)
    apiRestartTimer = setTimeout(startApi, 500)
  })
}

if (await isPortAvailable(apiPort)) {
  startApi()
} else {
  console.warn(`[Prism Demo] API 端口 ${apiPort} 已被占用，复用现有 API，不再重复启动`)
}
const web = spawn(pnpm, ['exec', 'vite'], {
  stdio: 'inherit',
  detached: process.platform !== 'win32',
})
children.add(web)

function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (apiRestartTimer) clearTimeout(apiRestartTimer)
  children.forEach(stopChild)
  setTimeout(() => process.exit(code), 200).unref()
}

web.on('exit', (code, signal) => {
  children.delete(web)
  if (!stopping && code !== 0) {
    console.error(`[Prism Demo] Vite 进程异常退出 (${signal || code})`)
    stop(code || 1)
  }
})
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
