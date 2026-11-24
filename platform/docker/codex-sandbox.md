# Codex sandbox on SELinux container hosts

If Codex reports `bwrap: Can't mount devpts ... Permission denied`, check the
host's SELinux policy before changing repository permissions. On Fedora Podman
hosts with udica templates installed, install the dedicated policy as root:

```sh
semodule -i /usr/share/udica/templates/base_container.cil prism-codex-selinux.cil
```

Set `PRISM_CODEX_SELINUX_TYPE=prism_codex.process` in the platform service
environment, restart the platform, and restart affected requirement environments.
For Podman Machine, install the policy inside the VM. Other hosts must validate
the policy against their installed container-selinux version first.

Only Codex requirement containers opt into this domain. SELinux enforcing and
MCS categories remain enabled, along with default seccomp, dropped capabilities,
no-new-privileges, and Codex's own filesystem and network sandbox. The domain
inherits the standard udica container base, restores private container file and
network permissions, and adds the devpts, namespace loopback, and temporary
read-only remount permissions needed by Bubblewrap. It does not disable labels.

The workspace image provides the official native `apply_patch` entry point on
PATH, independently of Codex's temporary session PATH. Image builds verify real
patch creation and editing. Codex containers additionally run an offline sandbox
preflight before starting the Agent: workspace reads and patch edits must work,
and writes outside the workspace must remain denied. This runs for both API key
and subscription authentication and makes no model requests.

Recreating the process container retains source and project auth volumes. A
container still using an old per-requirement auth volume needs its credentials
migrated to project auth or a project login before recreation.

To stop opting in, remove the environment variable and recreate the affected
containers. Once no container uses the domain, `semodule -r prism-codex-selinux`
removes this module; do not remove the shared udica base module.
