#!/bin/bash
set -e

# Init home dir on first run (volume mount may be empty)
if [ ! -f "$HOME/.bashrc" ] && [ -d /home/prism-skel ]; then
  cp -a /home/prism-skel/. "$HOME/"
fi

LOG_DIR="/var/log/prism"
mkdir -p "$LOG_DIR"

# Log helper: write to file and stdout
log_main() { tee -a "$LOG_DIR/main.log"; }

{
# 1. Configure Git
git config --global user.name "${GIT_USER_NAME:-Prism Studio Agent}"
git config --global user.email "${GIT_USER_EMAIL:-agent@prism-studio.dev}"
git config --global http.sslVerify false

# 2. Configure SSH key (for git@... URLs)
if [ -n "$GIT_SSH_KEY" ]; then
  mkdir -p $HOME/.ssh
  echo "$GIT_SSH_KEY" > $HOME/.ssh/id_rsa
  chmod 600 $HOME/.ssh/id_rsa

  SSH_PORT="${GIT_SSH_PORT:-36000}"
  cat > $HOME/.ssh/config <<SSHEOF
Host *
  Port ${SSH_PORT}
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  IdentityFile $HOME/.ssh/id_rsa
SSHEOF
  chmod 600 $HOME/.ssh/config
  echo "SSH configured: port ${SSH_PORT}"
fi

# 3. Configure HTTPS credentials (for https://... URLs)
if [ -n "$GIT_ACCESS_TOKEN" ]; then
  git config --global credential.helper store
  IFS=',' read -ra REPO_LIST <<< "$REPOS"
  for repo_spec in "${REPO_LIST[@]}"; do
    IFS='|' read -r name url branch <<< "$repo_spec"
    host=$(echo "$url" | sed -E 's|https?://([^/]+).*|\1|')
    echo "https://oauth2:${GIT_ACCESS_TOKEN}@${host}" >> $HOME/.git-credentials
  done
fi

# 4. Write CLAUDE.md
[ -n "$CLAUDE_MD" ] && echo "$CLAUDE_MD" > /workspace/CLAUDE.md

echo "Workspace initialized."
} 2>&1 | log_main

# 5. Run startup script if provided (5 min timeout, background)
if [ -n "$STARTUP_SCRIPT" ]; then
  echo "=== Startup script ===" | log_main
  echo "$STARTUP_SCRIPT" | log_main
  echo "=== Executing ===" | log_main
  {
    echo '#!/bin/bash'
    echo 'set -ex'
    echo "$STARTUP_SCRIPT"
  } > /tmp/startup.sh
  chmod +x /tmp/startup.sh
  timeout 300 /tmp/startup.sh > >(tee -a "$LOG_DIR/startup.log") 2>&1 &
fi

# 6. Start code-server (VS Code Web, with self-signed cert for clipboard access)
echo "Starting code-server on port 8080..." | log_main
code-server --bind-addr 0.0.0.0:8080 --auth none --disable-telemetry --cert -- /workspace > >(tee -a "$LOG_DIR/code-server.log") 2>&1 &

# 7. Export HTTPS proxy if set
if [ -n "$HTTPS_PROXY" ]; then
  export HTTPS_PROXY
  export https_proxy="$HTTPS_PROXY"
  echo "HTTPS proxy: $HTTPS_PROXY" | log_main
fi

# 8. Export agent URL so vite-plugin / next-plugin reuse workspace agent
export PRISM_AGENT_URL="http://localhost:9527"

# 9. Start Agent Server
# claude-sub uses the same Claude Agent SDK but relies on ~/.claude/ login credentials
AGENT_TYPE_FLAG=""
if [ -n "$AGENT_TYPE" ] && [ "$AGENT_TYPE" != "claude" ] && [ "$AGENT_TYPE" != "claude-sub" ]; then
  AGENT_TYPE_FLAG="--agent-type $AGENT_TYPE"
fi
echo "Starting agent server on port 9527 (type: ${AGENT_TYPE:-claude})..." | log_main
cd /workspace && node /prism-agent/dist/cli.js start --port 9527 $AGENT_TYPE_FLAG > >(tee -a "$LOG_DIR/agent.log") 2>&1
