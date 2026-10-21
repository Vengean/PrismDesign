import {test,after} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const directory = mkdtempSync(path.join(tmpdir(),"prism-retirement-test-"));
process.env.PRISM_DATA_DIR = directory;
process.env.ADMIN_USER = "migration-admin";
process.env.ADMIN_PASSWORD = "test-only-password";
const legacy = new Database(path.join(directory,"platform.db"));
legacy.exec(`
  CREATE TABLE users(id TEXT PRIMARY KEY,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT DEFAULT (datetime('now')));
  INSERT INTO users(id,password_hash,role) VALUES('existing-user','test-hash','user');
  CREATE TABLE workspaces(id TEXT PRIMARY KEY,container_id TEXT,anthropic_api_key TEXT);
  INSERT INTO workspaces VALUES('8730bb79-f489-42f1-a364-4b63cd66502d','prism-ws-8730bb79-f489-42f1-a364-4b63cd66502d','retired-secret');
  CREATE TABLE workspace_shares(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id));
  INSERT INTO workspace_shares VALUES('old-share','8730bb79-f489-42f1-a364-4b63cd66502d');
  CREATE TABLE preserved_project_data(id TEXT PRIMARY KEY);
  INSERT INTO preserved_project_data VALUES('keep-me');
`);
legacy.close();
const {getDb} = await import("../src/services/db.js");
after(() => {getDb().close();rmSync(directory,{recursive:true,force:true});});
test("retirement drops legacy tables while preserving accounts and unrelated data",() => {
  const db = getDb();
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('workspaces','workspace_shares')").get().n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM users WHERE id='existing-user'").get().n,1);
  assert.equal(db.prepare("SELECT id FROM preserved_project_data").get().id,"keep-me");
  const queue = db.prepare("SELECT workspace_id,container_id FROM legacy_resource_cleanup").all();
  assert.equal(queue.length,1);
  assert.equal((queue[0] as {workspace_id:string}).workspace_id,"8730bb79-f489-42f1-a364-4b63cd66502d");
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM legacy_resource_cleanup").all()).includes("retired-secret"));
  assert.equal(db.pragma("foreign_key_check").length,0);
});
