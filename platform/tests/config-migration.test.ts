import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('configuration migration retains current settings, requirements, releases and sessions',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'prism-config-migration-'));process.env.PRISM_DATA_DIR=dir;process.env.ADMIN_USER='owner';process.env.ADMIN_PASSWORD='fixture-password';
 const {getDb}=await import('../src/services/db.js');const db=getDb();
 try {
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,description TEXT,created_by TEXT,created_at TEXT);
   CREATE TABLE project_config_versions(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),version INTEGER,config TEXT);
   CREATE TABLE requirements(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,config_version_id TEXT NOT NULL REFERENCES project_config_versions(id),created_at TEXT);
   CREATE TABLE releases(id TEXT PRIMARY KEY,project_id TEXT,name TEXT,config_version_id TEXT NOT NULL REFERENCES project_config_versions(id),created_at TEXT);
   CREATE TABLE project_sessions(id TEXT PRIMARY KEY,requirement_id TEXT UNIQUE REFERENCES requirements(id),created_at TEXT);
   CREATE TABLE project_git_credentials(id TEXT PRIMARY KEY,project_id TEXT,encrypted_value TEXT);
   INSERT INTO projects(id,name) VALUES('p','Fixture');
   INSERT INTO project_git_credentials VALUES('old-key','p','old-encrypted'),('current-key','p','current-encrypted');`);
  const old={repos:[],gitAuth:{mode:'token',sshPort:22,credentialRef:'old-key'},model:{provider:'',baseUrl:'',model:''},initScript:'',startupScript:'old command',guidance:''};
  const current={...old,gitAuth:{...old.gitAuth,credentialRef:'current-key'},startupScript:'current command'};
  for(const [id,version,config] of [['v1',1,old],['v2',2,current]] as const)db.prepare('INSERT INTO project_config_versions VALUES(?,?,?,?)').run(id,'p',version,JSON.stringify(config));
  db.exec(`INSERT INTO requirements(id,project_id,title,config_version_id) VALUES('d','p','Demand','v1');INSERT INTO releases(id,project_id,name,config_version_id) VALUES('r','p','Release','v1');INSERT INTO project_sessions(id,requirement_id) VALUES('s','d');`);
  const {initProjectTables,projectConfig}=await import('../src/services/projects.js');initProjectTables();initProjectTables();
  assert.equal(projectConfig('p').startupScript,'current command');
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='project_config_versions'").get(),undefined);
  for(const table of ['requirements','releases'])assert.ok(!(db.pragma(`table_info(${table})`) as {name:string}[]).some(c=>c.name==='config_version_id'));
  assert.equal((db.prepare('SELECT requirement_id FROM project_sessions WHERE id=?').get('s') as {requirement_id:string}).requirement_id,'d');
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  assert.equal(db.prepare('SELECT id FROM project_git_credentials WHERE id=?').get('old-key'),undefined);
  assert.ok(db.prepare('SELECT id FROM project_git_credentials WHERE id=?').get('current-key'));
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
