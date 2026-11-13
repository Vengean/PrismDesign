// This entrypoint uses only tools already present in the workspace image.
// It prepares source and an editor without executing project install/start scripts.
export const workspaceEditorEntrypoint=String.raw`set -euo pipefail
mkdir -p /var/log/prism "$HOME/.ssh" "$HOME/.local/share/code-server/extensions"
umask 077
printf preparing > /var/log/prism/state
if [ -n "${'$'}{GIT_SSH_KEY:-}" ]; then
 node -e 'require("fs").writeFileSync(process.env.HOME+"/.ssh/id_prism",process.env.GIT_SSH_KEY.replace(/\r\n?/g,"\n").trim()+"\n",{mode:0o600})'
 export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_prism -p ${'$'}{GIT_SSH_PORT:-22} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
fi
if [ -n "${'$'}{GIT_ACCESS_TOKEN:-}" ]; then
 cat > /tmp/prism-askpass <<'ASKPASS'
#!/bin/sh
case "$1" in *Username*) printf '%s\n' 'x-access-token';; *) printf '%s\n' "$GIT_ACCESS_TOKEN";; esac
ASKPASS
 chmod 700 /tmp/prism-askpass
 export GIT_ASKPASS=/tmp/prism-askpass GIT_TERMINAL_PROMPT=0
fi
git config --global user.name 'Prism Studio Agent'
git config --global user.email 'agent@prism-studio.dev'
cd /workspace
while IFS= read -r spec; do
 mapfile -t parts < <(node -e 'for(const x of JSON.parse(process.argv[1])) console.log(x)' "$spec")
 name="${'$'}{parts[0]}"; url="${'$'}{parts[1]}"; branch="${'$'}{parts[2]}"
 if [ ! -d "$name/.git" ]; then
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
if [ ! -e /workspace/CLAUDE.md ] && [ ! -L /workspace/CLAUDE.md ]; then
 printf '%s\n' "${'$'}{CLAUDE_MD:-}" > /workspace/CLAUDE.md
fi
if [ -n "${'$'}{PRISM_AGENT_PROVIDER:-}" ]; then
 node /prism-agent/dist/cli.js start --port 9527 --provider "$PRISM_AGENT_PROVIDER" > /var/log/prism/agent.log 2>&1 &
fi
printf stopped > /var/log/prism/state
exec code-server --bind-addr 0.0.0.0:8080 --auth none --disable-telemetry /workspace > /var/log/prism/code-server.log 2>&1
`;
export const editorReadyProgram=String.raw`const net=require('node:net');const socket=net.connect(8080,'127.0.0.1');socket.setTimeout(1000);socket.on('connect',()=>{socket.destroy();process.exit(0)});socket.on('error',()=>process.exit(1));socket.on('timeout',()=>process.exit(1));`;
