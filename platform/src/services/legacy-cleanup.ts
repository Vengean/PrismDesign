import Docker from "dockerode";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "./db.js";

/** Retire only the exact resource names captured from the removed legacy table. */
export async function cleanupLegacyResources() {
  const db = getDb();
  const rows = db.prepare("SELECT workspace_id,container_id FROM legacy_resource_cleanup").all() as {workspace_id:string;container_id:string|null}[];
  if (!rows.length) return;
  const candidates = [process.env.CONTAINER_SOCKET,
    path.join(os.homedir(),".local/share/containers/podman/machine/podman.sock"),
    path.join(os.homedir(),".config/containers/podman/machine/podman.sock"),
    process.env.XDG_RUNTIME_DIR ? `${process.env.XDG_RUNTIME_DIR}/podman/podman.sock` : undefined,
    "/run/podman/podman.sock","/var/run/docker.sock",
  ].filter((p): p is string => !!p);
  const docker = new Docker({socketPath:candidates.find(p => fs.existsSync(p)) || "/var/run/docker.sock",timeout:5000});
  for (const row of rows) {
    if (!/^[0-9a-f-]{36}$/i.test(row.workspace_id)) {
      db.prepare("UPDATE legacy_resource_cleanup SET last_error=? WHERE workspace_id=?").run("旧资源标识无效，未执行清理",row.workspace_id); continue;
    }
    try {
      const name = `prism-ws-${row.workspace_id}`;
      // Never trust arbitrary container IDs from a stale database to identify unrelated containers.
      const container = docker.getContainer(name);
      try {await container.remove({force:true});} catch(e) {if ((e as {statusCode?:number}).statusCode !== 404) throw e;}
      for (const volume of [name,`prism-home-${row.workspace_id}`]) {
        try {await docker.getVolume(volume).remove();} catch(e) {if ((e as {statusCode?:number}).statusCode !== 404) throw e;}
      }
      db.prepare("DELETE FROM legacy_resource_cleanup WHERE workspace_id=?").run(row.workspace_id);
    } catch {
      db.prepare("UPDATE legacy_resource_cleanup SET last_error=? WHERE workspace_id=?").run("容器引擎不可用或资源仍被占用，等待下次启动重试",row.workspace_id);
      console.warn(`[Legacy cleanup] Resource ${row.workspace_id} pending cleanup`);
    }
  }
}
