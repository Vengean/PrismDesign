import Docker from 'dockerode';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function containerEngine(timeoutMs=15000){
 const candidates=[process.env.CONTAINER_SOCKET,path.join(os.homedir(),'.local/share/containers/podman/machine/podman.sock'),path.join(os.homedir(),'.config/containers/podman/machine/podman.sock'),process.env.XDG_RUNTIME_DIR&&`${process.env.XDG_RUNTIME_DIR}/podman/podman.sock`,'/run/podman/podman.sock','/var/run/docker.sock'];
 return new Docker({socketPath:candidates.find(p=>p&&fs.existsSync(p))||'/var/run/docker.sock',timeout:timeoutMs});
}
