import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

export default {
  provider: 'codex',
  mcpServers: {
    demo_fixtures: {
      command: process.execPath,
      args: [path.join(projectRoot, 'server/fixture-mcp.mjs')],
      env: {
        PRISM_FIXTURE_MODE: 'true',
        PRISM_PROJECT_ROOT: projectRoot,
        PRISM_DB_PATH: path.join(projectRoot, 'server/data/prism-demo.db'),
      },
      defaultToolsApprovalMode: 'approve',
    },
  },
}
