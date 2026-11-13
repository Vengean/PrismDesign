import type {PlatformDatabase} from './database.js';
export async function initReleaseSchema(db:PlatformDatabase){
 const mysql=db.dialect==='mysql',id=mysql?'VARCHAR(191)':'TEXT',text=mysql?'LONGTEXT':'TEXT',date=mysql?'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP':"TEXT NOT NULL DEFAULT (datetime('now'))";
 async function add(table:string,name:string,definition:string){
  const exists=mysql?await db.prepare('SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?').get(table,name):(await db.prepare(`PRAGMA table_info(${table})`).all()).some((c:any)=>c.name===name);
  if(!exists)await db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
 }
 await add('requirements','release_id',mysql?`${id} NULL`:`TEXT REFERENCES releases(id)`);
 for(const table of ['requirements','releases']){
  await add(table,'branch_status',"VARCHAR(24) NOT NULL DEFAULT 'legacy'");await add(table,'branch_error',`${text} NOT NULL DEFAULT ${mysql?"('')":"''"}`);
 }
 await add('requirements','branch_name',"VARCHAR(191) NOT NULL DEFAULT ''");
 await add('releases','branch_name',"VARCHAR(191) NOT NULL DEFAULT ''");
 await add('releases','operation_token',`${id} NULL`);await add('releases','operation_kind',"VARCHAR(30) NOT NULL DEFAULT ''");
 await add('releases','frozen_manifest',`${text} NOT NULL DEFAULT ${mysql?"('{}')":"'{}'"}`);
 const suffix=mysql?' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin':'';
 for(const [name,body] of [
  ['release_repositories',`release_id ${id} NOT NULL,repo_name VARCHAR(80) NOT NULL,url ${text} NOT NULL,source_ref VARCHAR(200) NOT NULL,base_sha VARCHAR(64),head_sha VARCHAR(64),branch_status VARCHAR(24) NOT NULL DEFAULT 'pending',error ${text} NOT NULL DEFAULT ${mysql?"('')":"''"},PRIMARY KEY(release_id,repo_name),FOREIGN KEY(release_id) REFERENCES releases(id)`],
  ['requirement_repositories',`requirement_id ${id} NOT NULL,repo_name VARCHAR(80) NOT NULL,url ${text} NOT NULL,base_sha VARCHAR(64),head_sha VARCHAR(64),branch_status VARCHAR(24) NOT NULL DEFAULT 'pending',error ${text} NOT NULL DEFAULT ${mysql?"('')":"''"},PRIMARY KEY(requirement_id,repo_name),FOREIGN KEY(requirement_id) REFERENCES requirements(id)`],
  ['merge_requests',`id ${id} PRIMARY KEY,requirement_id ${id} NOT NULL,release_id ${id} NOT NULL,submitted_by ${id} NOT NULL,approved_by ${id},status VARCHAR(30) NOT NULL DEFAULT 'submitted',manifest ${text} NOT NULL,results ${text} NOT NULL,reason ${text} NOT NULL DEFAULT ${mysql?"('')":"''"},created_at ${date},updated_at ${date},FOREIGN KEY(requirement_id) REFERENCES requirements(id),FOREIGN KEY(release_id) REFERENCES releases(id),FOREIGN KEY(submitted_by) REFERENCES users(id)`],
  ['release_events',`id ${id} PRIMARY KEY,release_id ${id} NOT NULL,user_id ${id} NOT NULL,type VARCHAR(40) NOT NULL,data ${text} NOT NULL,created_at ${date},FOREIGN KEY(release_id) REFERENCES releases(id)`],
 ] as [string,string][])await db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${body})${suffix}`);
 if(mysql){
  if(!await db.prepare("SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='requirements' AND constraint_name='requirements_release_fk'").get())await db.exec('ALTER TABLE requirements ADD CONSTRAINT requirements_release_fk FOREIGN KEY(release_id) REFERENCES releases(id)');
 }else await db.exec('CREATE INDEX IF NOT EXISTS requirements_release_idx ON requirements(release_id)');
}
