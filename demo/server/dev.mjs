import { spawn } from 'node:child_process'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const children = [
  spawn(pnpm, ['exec', 'tsx', 'watch', 'server/index.ts'], { stdio: 'inherit' }),
  spawn(pnpm, ['exec', 'vite'], { stdio: 'inherit' }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  children.forEach((child) => child.kill('SIGTERM'))
  setTimeout(() => process.exit(code), 200).unref()
}

children.forEach((child) => child.on('exit', (code, signal) => {
  if (!stopping && code !== 0) {
    console.error(`[Prism Demo] 子进程异常退出 (${signal || code})`)
    stop(code || 1)
  }
}))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
