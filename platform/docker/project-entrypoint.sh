#!/bin/bash
set -euo pipefail
mkdir -p /var/log/prism "$HOME/.ssh" "$HOME/.local/share/code-server/extensions"
umask 077
node /preview-proxy.cjs > /var/log/prism/proxy.log 2>&1 &
# Credentials are never embedded into repository URLs or echoed to logs.
if [ -n "${GIT_SSH_KEY:-}" ]; then
  printf '%s\n' "$GIT_SSH_KEY" > "$HOME/.ssh/id_prism"
  export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_prism -p ${GIT_SSH_PORT:-22} -o StrictHostKeyChecking=accept-new"
fi
if [ -n "${GIT_ACCESS_TOKEN:-}" ]; then
  cat > /tmp/prism-askpass <<'ASKPASS'
#!/bin/sh
case "$1" in *Username*) printf '%s\n' 'x-access-token';; *) printf '%s\n' "$GIT_ACCESS_TOKEN";; esac
ASKPASS
  chmod 700 /tmp/prism-askpass
  export GIT_ASKPASS=/tmp/prism-askpass GIT_TERMINAL_PROMPT=0
fi
git config --global user.name 'Prism Studio Agent'
git config --global user.email 'agent@prism-studio.dev'
fail() { printf 'failed' > /var/log/prism/state; echo '环境准备失败，请查看日志。'; }
trap fail ERR
printf 'preparing' > /var/log/prism/state
cd /workspace
# JSON is parsed with node; names/URLs/branches are passed as arguments, never shell code.
while IFS= read -r spec; do
  mapfile -t parts < <(node -e 'for(const x of JSON.parse(process.argv[1])) console.log(x)' "$spec")
  name="${parts[0]}"; url="${parts[1]}"; branch="${parts[2]}"
  if [ ! -d "$name/.git" ]; then
    echo "正在拉取仓库 $name"
    clone_dir=$(mktemp -d /workspace/.prism-clone-XXXXXX)
    git clone --branch "$branch" -- "$url" "$clone_dir"
    mv -- "$clone_dir" "$name"
  fi
  git -C "$name" remote set-url origin "$url"
  if ! git -C "$name" rev-parse --verify "$PRISM_BRANCH" >/dev/null 2>&1; then
    git -C "$name" switch -c "$PRISM_BRANCH"
  else
    git -C "$name" switch "$PRISM_BRANCH"
  fi
done < <(node -e 'for(const r of JSON.parse(process.env.PRISM_REPOS))console.log(JSON.stringify([r.name,r.url,r.branch]))')
printf '%s\n' "${CLAUDE_MD:-}" > /workspace/CLAUDE.md
init_hash=$(printf '%s' "$INIT_SCRIPT" | sha256sum | cut -d' ' -f1)
if [ "$(cat /workspace/.prism-init-hash 2>/dev/null || true)" != "$init_hash" ]; then
  echo '执行初始化脚本'
  printf '%s\n' "$INIT_SCRIPT" > /tmp/prism-init.sh
  timeout "${PRISM_INIT_TIMEOUT:-1800}" bash -e /tmp/prism-init.sh
  printf '%s' "$init_hash" > /workspace/.prism-init-hash
fi
printf 'starting' > /var/log/prism/state
code-server --bind-addr 0.0.0.0:8080 --auth none --disable-telemetry /workspace > /var/log/prism/code-server.log 2>&1 &
# SDK selection follows the immutable project configuration pinned to this requirement.
node /prism-agent/dist/cli.js start --port 9527 --provider "$PRISM_AGENT_PROVIDER" > /var/log/prism/agent.log 2>&1 &
printf '%s\n' "$STARTUP_SCRIPT" > /tmp/prism-start.sh
echo '执行启动脚本'
bash -e /tmp/prism-start.sh > >(tee -a /var/log/prism/startup.log) 2>&1 &
startup_pid=$!
while true; do
  if ! kill -0 "$startup_pid" 2>/dev/null; then
    if wait "$startup_pid"; then echo '启动脚本已执行完毕'; else fail; exit 1; fi
    startup_pid=0
  fi
  sleep 2
  # A successful background startup script is allowed to leave its services running.
  if [ "$startup_pid" = 0 ]; then sleep infinity & wait $!; fi
done
