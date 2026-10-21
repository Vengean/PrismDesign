import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";

const dataDir = mkdtempSync(path.join(tmpdir(),"prism-project-test-"));
process.env.PRISM_DATA_DIR = dataDir;
process.env.ADMIN_USER = "test-admin";
process.env.ADMIN_PASSWORD = "test-only-password";
const { getDb, createUser } = await import("../src/services/db.js");
const { initProjectTables, emptyConfig, resolveProjectGitCredential, resolveProjectModelCredential, resolveProjectAgentRuntime, createProject } = await import("../src/services/projects.js");
const { signToken } = await import("../src/middleware/auth.js");
const { default: routes } = await import("../src/routes/projects.js");
initProjectTables(); initProjectTables(); // Existing databases can initialize repeatedly.
for (const id of ["editor","viewer","outsider","second-admin"]) createUser(id,"unused-test-hash");
const app = express(); app.use(express.json()); app.use("/api/projects",routes);
const server = app.listen(0,"127.0.0.1");
await new Promise<void>((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api/projects`;
async function call(user: string | null, method: string, suffix = "", body?: unknown, resource = "projects") {
  const response = await fetch(base.replace(/projects$/,resource)+suffix,{ method, headers: {
    "Content-Type": "application/json",
    ...(user ? { Authorization: `Bearer ${signToken({ userId: user,role: user === "test-admin" ? "admin" : "user" })}` } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); getDb().close(); rmSync(dataDir,{ recursive:true,force:true }); });

test("project access, settings and persistent default sessions",async t => {
  let projectId: string;
  await t.test("requires authentication and developer identity for project creation",async () => {
    assert.equal((await call(null,"GET")).status,401);
    assert.equal((await call("editor","POST","",{ name:"Denied" })).status,403);
  });
  await t.test("creates project, members and configuration atomically",async () => {
    const result = await call("test-admin","POST","",{ name:"Platform test",members:[
      { userId:"editor",role:"editor" },{ userId:"viewer",role:"viewer" },
    ] });
    assert.equal(result.status,201); projectId = result.data.id;
    const invalid = await call("test-admin","POST","",{ name:"Invalid",members:[{ userId:"missing",role:"viewer" }] });
    assert.equal(invalid.status,400);
    assert.equal((await call("test-admin","GET")).data.items.length,1);
  });
  await t.test("outsiders are hidden but platform administrators have default project access",async () => {
    assert.deepEqual((await call("outsider","GET")).data,{items:[],nextCursor:null});
    assert.equal((await call("outsider","GET",`/${projectId}`)).status,404);
    getDb().prepare("UPDATE users SET role='admin' WHERE id='outsider'").run();
    const p = await call("outsider","GET",`/${projectId}`);
    assert.equal(p.status,200);
    assert.equal(p.data.access_role,"admin");
    assert.equal((await call("outsider","GET")).data.items.length,1);
    assert.ok(p.data.members.some((m: {user_id:string;permission_source:string}) => m.user_id === "outsider" && m.permission_source === "platform_admin"));
    assert.ok(!p.data.member_candidates.some((u: {id:string}) => ["test-admin","outsider"].includes(u.id)));
    assert.equal((await call("outsider","GET","/missing-project")).status,404);
    assert.equal((await call("test-admin","PUT",`/${projectId}/members/outsider`,{role:"viewer"})).status,409);
    assert.equal((await call("test-admin","DELETE",`/${projectId}/members/outsider`)).status,409);
    getDb().prepare("UPDATE users SET role='user' WHERE id='outsider'").run();
    assert.equal((await call("outsider","GET",`/${projectId}`)).status,404);
  });
  await t.test("creator access survives missing or stale membership and platform role changes",async () => {
    getDb().prepare("DELETE FROM project_members WHERE project_id=? AND user_id='test-admin'").run(projectId);
    getDb().prepare("UPDATE users SET role='user' WHERE id='test-admin'").run();
    const p = await call("test-admin","GET",`/${projectId}`);
    assert.equal(p.status,200); assert.equal(p.data.access_role,"admin");
    assert.equal((await call("test-admin","GET")).data.items[0].access_role,"admin");
    assert.ok(p.data.members.some((m: {user_id:string;permission_source:string}) => m.user_id === "test-admin" && m.permission_source === "creator"));
    assert.equal((await call("test-admin","DELETE",`/${projectId}/members/test-admin`)).status,409);
    getDb().prepare("UPDATE users SET role='admin' WHERE id='test-admin'").run();
  });
  await t.test("viewers cannot read configuration, create requirements or edit membership",async () => {
    const p = await call("viewer","GET",`/${projectId}`);
    assert.equal(p.status,200); assert.equal(p.data.config,undefined);
    assert.equal((await call("viewer","POST",`/${projectId}/requirements`,{ title:"Denied" })).status,403);
    assert.equal((await call("viewer","PUT",`/${projectId}/members/viewer`,{ role:"admin" })).status,403);
    assert.equal((await call("editor","PUT",`/${projectId}/config`,emptyConfig)).status,403);
  });
  await t.test("requirements retain sessions while project settings are overwritten",async () => {
    const requirement = await call("editor","POST",`/${projectId}/requirements`,{ title:"First",acceptance:"Must work" });
    assert.equal(requirement.status,201); assert.ok(requirement.data.session_id);
    assert.equal(requirement.data.environment_status,"pending");
    assert.equal((await call("test-admin","PUT",`/${projectId}/config`,{ ...emptyConfig,guidance:"new version" })).status,200);
    const project = (await call("editor","GET",`/${projectId}`)).data;
    assert.equal(project.config_version,undefined);
    assert.equal(project.requirements[0].config_version_id,undefined);
    assert.equal(project.requirements[0].session_id,requirement.data.session_id);
    assert.equal((await call("viewer","GET",`/${projectId}`)).data.requirements[0].session_id,requirement.data.session_id);
  });
  await t.test("releases are administrator-only and do not create Agent sessions",async () => {
    assert.equal((await call("editor","POST",`/${projectId}/releases`,{ name:"Denied" })).status,403);
    assert.equal((await call("test-admin","POST",`/${projectId}/releases`,{ name:"Release 1" })).status,201);
    assert.equal((getDb().prepare("SELECT count(*) AS n FROM project_sessions").get() as {n:number}).n,1);
  });
  await t.test("rejects invalid configuration and inline credentials",async () => {
    for (const config of [
      {...emptyConfig,gitAuth:{mode:"none",sshPort:22}},
      {...emptyConfig,apiKey:"do-not-store"},
      {...emptyConfig,repos:[{name:"app",url:"https://user:secret@example.com/a.git",branch:"main"}]},
      {...emptyConfig,repos:[{name:"app",url:"https://example.com/a.git?token=secret",branch:"main"}]},
      {...emptyConfig,previewPort:99999},
      {...emptyConfig,additionalPorts:[5173]},
      {...emptyConfig,additionalPorts:[3000,3000]},
      {...emptyConfig,additionalPorts:[0]},
      {...emptyConfig,model:{provider:"test",baseUrl:"https://example.com?token=secret",model:"test"}},
    ]) assert.equal((await call("test-admin","PUT",`/${projectId}/config`,config)).status,400);
  });
  await t.test("protects last administrator and revokes access immediately",async () => {
    assert.equal((await call("test-admin","DELETE",`/${projectId}/members/test-admin`)).status,409);
    assert.equal((await call("test-admin","PUT",`/${projectId}/members/test-admin`,{role:"viewer"})).status,409);
    assert.equal((await call("test-admin","DELETE",`/${projectId}/members/editor`)).status,200);
    assert.equal((await call("editor","GET",`/${projectId}`)).status,404);
    assert.equal((await call("editor","POST",`/${projectId}/requirements`,{title:"Denied"})).status,404);
  });
  await t.test("deleted users cannot use otherwise valid JWTs",async () => {
    getDb().prepare("DELETE FROM users WHERE id='viewer'").run();
    assert.equal((await call("viewer","GET")).status,401);
  });
  await t.test("project Git credentials are shared, encrypted, redacted and overwritten",async () => {
    const config = { ...emptyConfig,repos: [
      { name:"web",url:"https://example.com/web.git",branch:"main" },
      { name:"api",url:"https://example.com/api.git",branch:"main" },
    ],gitAuth:{mode:"token",sshPort:22,token:"fixture-token-original"} };
    const created = await call("test-admin","POST","",{name:"Private repos",config});
    assert.equal(created.status,201);
    const id = created.data.id;
    const detail = (await call("test-admin","GET",`/${id}`)).data;
    assert.ok(!JSON.stringify(detail).includes("fixture-token-original"));
    assert.equal(detail.config.repos[0].gitAuth,undefined);
    const rawConfig = getDb().prepare("SELECT config FROM project_configs WHERE project_id=?").get(id) as {config:string};
    assert.ok(!rawConfig.config.includes("fixture-token-original"));
    const encrypted = getDb().prepare("SELECT encrypted_value FROM project_git_credentials WHERE project_id=?").all(id);
    assert.equal(encrypted.length,1);
    assert.ok(!JSON.stringify(encrypted).includes("fixture-token-original"));
    const ref = detail.config.gitAuth.credentialRef;
    assert.equal(detail.config.gitAuth.hasToken,true);
    assert.equal(resolveProjectGitCredential(id,ref).secret,"fixture-token-original");
    assert.throws(() => resolveProjectGitCredential(projectId,ref));
    assert.equal((await call("test-admin","PUT",`/${id}/config`,detail.config)).status,200);
    const updated = structuredClone(detail.config);
    updated.gitAuth.token = "fixture-token-rotated";
    assert.equal((await call("test-admin","PUT",`/${id}/config`,updated)).status,200);
    const newConfig = (await call("test-admin","GET",`/${id}`)).data.config;
    assert.equal(newConfig.gitAuth.credentialRef,ref);
    assert.equal(resolveProjectGitCredential(id,ref).secret,"fixture-token-rotated");
    assert.equal(resolveProjectGitCredential(id,newConfig.gitAuth.credentialRef).secret,"fixture-token-rotated");
    const sshConfig = {...config,repos:config.repos.map(r => ({...r,url:`git@example.com:${r.name}.git`})),gitAuth:{mode:"ssh",sshPort:36000,sshKey:"fixture-private-key"}};
    assert.equal((await call("test-admin","PUT",`/${id}/config`,sshConfig)).status,200);
    const ssh = (await call("test-admin","GET",`/${id}`)).data.config.gitAuth;
    assert.equal(ssh.sshPort,36000); assert.equal(ssh.sshKey,undefined);
    assert.equal(resolveProjectGitCredential(id,ssh.credentialRef).secret,"fixture-private-key");
    assert.equal((await call("test-admin","POST","",{name:"Missing token",config:{...config,gitAuth:{mode:"token",sshPort:22}}})).status,400);
    assert.equal((await call("test-admin","POST","",{name:"Invalid port",config:{...sshConfig,gitAuth:{...sshConfig.gitAuth,sshPort:65536}}})).status,400);
    assert.equal((await call("test-admin","POST","",{name:"Invalid transport",config:{...sshConfig,gitAuth:config.gitAuth}})).status,400);
  });
  await t.test("unified scripts persist without service directories or manually configured preview ports",async () => {
    const config = {...emptyConfig,initScript:"pnpm --dir frontend install",startupScript:"pnpm --dir frontend dev --host 0.0.0.0"};
    assert.equal((await call("test-admin","PUT",`/${projectId}/config`,config)).status,200);
    assert.deepEqual((await call("test-admin","GET",`/${projectId}`)).data.config,config);
  });
  await t.test("legacy services become scripts without exposing port fields",async () => {
    const legacy = {repos:[],model:emptyConfig.model,installCommand:"pnpm install",startupScript:"echo prepare",guidance:"",services:[
      {name:"web",directory:"frontend",command:"pnpm dev",port:8080},
      {name:"api",directory:"backend",command:"pnpm start",port:3000},
    ]};
    const row = {id:projectId};
    getDb().prepare("UPDATE project_configs SET config=? WHERE project_id=?").run(JSON.stringify(legacy),row.id);
    const config = (await call("test-admin","GET",`/${projectId}`)).data.config;
    assert.equal(config.initScript,"pnpm install");
    assert.equal(config.previewPort,undefined); assert.equal(config.additionalPorts,undefined);
    assert.ok(config.startupScript.includes("echo prepare"));
    assert.ok(config.startupScript.includes("cd '/workspace/frontend' && pnpm dev"));
    assert.ok(config.startupScript.includes("cd '/workspace/backend' && pnpm start"));
    assert.ok(config.startupScript.endsWith("wait -n"));
    assert.equal(config.services,undefined); assert.equal(config.installCommand,undefined);
    assert.equal((getDb().prepare("SELECT config FROM project_configs WHERE project_id=?").get(row.id) as {config:string}).config,JSON.stringify(legacy));
    assert.equal((await call("test-admin","PUT",`/${projectId}/config`,config)).status,200);
  });  await t.test("different legacy repository credentials require an explicit shared replacement",async () => {
    const legacy = {...emptyConfig,gitAuth:undefined,repos:[
      {name:"web",url:"https://example.com/web.git",branch:"main",credentialRef:"old-a",gitAuth:{mode:"token",sshPort:22,hasToken:true}},
      {name:"api",url:"https://example.com/api.git",branch:"main",credentialRef:"old-b",gitAuth:{mode:"token",sshPort:22,hasToken:true}},
    ]};
    const row = {id:projectId};
    getDb().prepare("UPDATE project_configs SET config=? WHERE project_id=?").run(JSON.stringify(legacy),row.id);
    const config = (await call("test-admin","GET",`/${projectId}`)).data.config;
    assert.equal(config.gitAuth.requiresUpdate,true);
    assert.equal(config.gitAuth.credentialRef,undefined);
    assert.equal((await call("test-admin","PUT",`/${projectId}/config`,config)).status,400);
    config.gitAuth.token = "replacement-token";
    assert.equal((await call("test-admin","PUT",`/${projectId}/config`,config)).status,200);
    const saved = (await call("test-admin","GET",`/${projectId}`)).data.config;
    assert.equal(saved.gitAuth.requiresUpdate,undefined);
    assert.equal(saved.repos[0].credentialRef,undefined);
  });
  await t.test("GLM is configured per project and model credentials stay encrypted",async () => {
    const config = {...emptyConfig,model:{provider:"glm",baseUrl:"https://models.example.com",model:"company-glm",apiKey:"project-model-secret"}};
    const project = await call("test-admin","POST","",{name:"GLM project",config});
    assert.equal(project.status,201);
    const id = project.data.id;
    const detail = (await call("test-admin","GET",`/${id}`)).data;
    assert.equal(detail.config.model.baseUrl,config.model.baseUrl);
    assert.equal(detail.config.model.model,config.model.model);
    assert.equal(detail.config.model.provider,"glm");
    assert.equal(detail.config.model.hasApiKey,true);
    assert.ok(!JSON.stringify(detail).includes("project-model-secret"));
    const ref = detail.config.model.credentialRef;
    assert.equal(resolveProjectModelCredential(id,ref),"project-model-secret");
    assert.deepEqual(resolveProjectAgentRuntime(id),{provider:"glm",apiKey:"project-model-secret",baseUrl:config.model.baseUrl,model:config.model.model});
    assert.throws(() => resolveProjectModelCredential(projectId,ref));
    assert.ok(!JSON.stringify(getDb().prepare("SELECT * FROM project_configs WHERE project_id=?").all(id)).includes("project-model-secret"));
    assert.ok(!JSON.stringify(getDb().prepare("SELECT * FROM project_model_credentials WHERE project_id=?").all(id)).includes("project-model-secret"));
    assert.equal((await call("test-admin","PUT",`/${id}/config`,detail.config)).status,200);
    const changed = {...detail.config,model:{...detail.config.model,model:"another-glm"}};
    assert.equal((await call("test-admin","PUT",`/${id}/config`,changed)).status,200);
    const refreshed = (await call("test-admin","GET",`/${id}`)).data.config;
    assert.equal(refreshed.model.model,"another-glm");
    assert.equal(refreshed.model.credentialRef,ref);
    assert.equal((await call("test-admin","POST","",{name:"Missing key",config:{...config,model:{...config.model,apiKey:undefined,credentialRef:ref,hasApiKey:true}}})).status,400);
    assert.equal((await call("test-admin","POST","",{name:"Other provider",config:{...config,model:{...config.model,provider:"openai"}}})).status,400);
    assert.equal((await call("test-admin","PUT",`/${id}/config`,{...detail.config,model:{...detail.config.model,baseUrl:"https://new.example.com"}})).status,400);
    // Old catalog-backed settings retain their settings and keys, but no longer need a catalog lookup.
    const row = {id:id};
    getDb().prepare("UPDATE project_configs SET config=? WHERE project_id=?").run(JSON.stringify({...refreshed,model:{...refreshed.model,provider:"zhipu",supplierId:"old-catalog-id"}}),row.id);
    const migrated = (await call("test-admin","GET",`/${id}`)).data.config;
    assert.equal(migrated.model.supplierId,undefined);
    assert.equal(migrated.model.provider,"glm");
    assert.equal(migrated.model.baseUrl,config.model.baseUrl);
    assert.equal(migrated.model.credentialRef,ref);
    assert.equal((await call("test-admin","PUT",`/${id}/config`,migrated)).status,200);
    const claude = await call("test-admin","POST","",{name:"Claude SDK project",config:{...config,model:{...config.model,provider:"claude",apiKey:"claude-fixture-key"}}});
    assert.equal(claude.status,201);
    assert.equal(resolveProjectAgentRuntime(claude.data.id).provider,"claude");
    assert.equal(resolveProjectAgentRuntime(id).model,"another-glm");
    assert.equal((await fetch(base.replace(/projects$/,"model-suppliers"),{headers:{Authorization:`Bearer ${signToken({userId:"test-admin",role:"admin"})}`}})).status,404);
  });
  await t.test("cursor pagination searches authorized projects without duplicates",async () => {
    const expected = new Set<string>();
    for(let i=0;i<13;i++)expected.add(createProject(`paging-fixture-${i}`,"Paged project","test-admin",[{userId:"second-admin",role:"viewer"}],emptyConfig));
    createProject("paging-fixture-private","Hidden","outsider",[],emptyConfig);
    const seen:string[]=[];let cursor:string|null=null;
    do {
      const result = await call("second-admin","GET",`?q=paging-fixture&limit=5${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);
      assert.equal(result.status,200);assert.ok(result.data.items.length<=5);
      for(const item of result.data.items){assert.ok(expected.has(item.id));seen.push(item.id);}
      cursor=result.data.nextCursor;
    }while(cursor);
    assert.equal(seen.length,13);assert.equal(new Set(seen).size,13);
    assert.deepEqual((await call("second-admin","GET","?q=does-not-exist&limit=5")).data,{items:[],nextCursor:null});
    for(const suffix of ["?limit=0","?limit=61","?limit=bad","?cursor=bad"]){assert.equal((await call("second-admin","GET",suffix)).status,400);}
    createProject("literal_%_query","Search literal symbols","test-admin",[{userId:"second-admin",role:"viewer"}],emptyConfig);
    assert.equal((await call("second-admin","GET","?q="+encodeURIComponent("_%_"))).data.items.length,1);
  });

});
