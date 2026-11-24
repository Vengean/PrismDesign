import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildAgentEnvironment } from "../src/services/agent-runtime.js";
import { codexAuthentication } from '../../packages/agent/src/providers/codex-auth.js';
import {applyModelProxy} from '../../packages/agent/src/model-proxy.js';

test('workspace initialization stays direct while Agent and login helpers receive the model proxy',()=>{
 const config={provider:'codex' as const,authMode:'subscription' as const,apiKey:'',baseUrl:'',model:'',proxyUrl:'http://proxy.example.com:7890'};
 const workspace=buildAgentEnvironment(config,{proxyScope:'agent'});
 const env=Object.fromEntries(workspace.map(item=>{const i=item.indexOf('=');return [item.slice(0,i),item.slice(i+1)];}));
 assert.equal(env.HTTP_PROXY,undefined);assert.equal(env.HTTPS_PROXY,undefined);
 env.NO_PROXY='registry.internal';applyModelProxy(env);
 assert.equal(env.HTTPS_PROXY,config.proxyUrl);assert.equal(env.http_proxy,config.proxyUrl);
 assert.ok(env.NO_PROXY.includes('registry.internal'));assert.ok(env.no_proxy.includes('localhost'));
 assert.ok(buildAgentEnvironment(config).includes(`HTTPS_PROXY=${config.proxyUrl}`));
 const direct={HTTP_PROXY:'http://deployment-proxy'};applyModelProxy(direct);assert.equal(direct.HTTP_PROXY,'http://deployment-proxy');
});

test("runtime environment selects the requested SDK and carries its configuration", () => {
  for (const provider of ["claude","glm"] as const) {
    const env = buildAgentEnvironment({provider,apiKey:"fixture-key",baseUrl:"https://fixture.example.com",model:"fixture-model"});
    assert.ok(env.includes(`PRISM_AGENT_PROVIDER=${provider}`));
    assert.ok(env.includes(`AGENT_TYPE=${provider}`));
    assert.ok(env.includes("ANTHROPIC_API_KEY=fixture-key"));
    assert.ok(env.includes("ANTHROPIC_BASE_URL=https://fixture.example.com"));
    assert.ok(env.includes("ANTHROPIC_MODEL=fixture-model"));
  }
});

test('Codex runtime separates API authentication from subscription and forwards proxy settings',()=>{
 const api=buildAgentEnvironment({provider:'codex',authMode:'api-key',apiKey:'fixture-key',baseUrl:'https://gateway.example.com/v1',model:'fixture-model',proxyUrl:'http://proxy.example.com:7890'});
 assert.ok(api.includes('CODEX_API_KEY=fixture-key'));
 assert.ok(api.includes('OPENAI_BASE_URL=https://gateway.example.com/v1'));
 assert.ok(api.includes('CODEX_MODEL=fixture-model'));
 assert.ok(api.includes('HTTPS_PROXY=http://proxy.example.com:7890'));
 assert.ok(api.includes('NO_PROXY=localhost,127.0.0.1,::1'));
 const sub=buildAgentEnvironment({provider:'codex',authMode:'subscription',apiKey:'must-not-pass',baseUrl:'https://must-not-pass.example.com',model:''});
 assert.ok(sub.includes('CODEX_AUTH_MODE=subscription'));
 assert.ok(sub.includes('CODEX_HOME=/project-auth/codex'));
 assert.ok(!sub.some(value=>value.includes('must-not-pass')||value.startsWith('ANTHROPIC_')));
 assert.throws(()=>buildAgentEnvironment({provider:'codex',apiKey:'',baseUrl:'',model:''}),/API Key/);
});

test('Codex SDK uses the selected billing mode even with conflicting inherited credentials',()=>{
 const source={CODEX_AUTH_MODE:'subscription',CODEX_API_KEY:'old-key',OPENAI_API_KEY:'other-key',OPENAI_BASE_URL:'https://old.example.com',CODEX_HOME:'/persist/codex',HTTPS_PROXY:'http://proxy:7890'};
 const sub=codexAuthentication(source);
 assert.equal(sub.apiKey,undefined);assert.equal(sub.baseUrl,undefined);
 assert.deepEqual(sub.config,{forced_login_method:'chatgpt'});
 assert.equal(sub.env?.CODEX_API_KEY,undefined);assert.equal(sub.env?.OPENAI_API_KEY,undefined);assert.equal(sub.env?.OPENAI_BASE_URL,undefined);
 assert.equal(sub.env?.CODEX_HOME,source.CODEX_HOME);assert.equal(sub.env?.HTTPS_PROXY,source.HTTPS_PROXY);
 assert.equal(source.CODEX_API_KEY,'old-key');
 const api=codexAuthentication({...source,CODEX_AUTH_MODE:'api-key'});
 assert.equal(api.apiKey,'old-key');assert.equal(api.baseUrl,source.OPENAI_BASE_URL);
 assert.deepEqual(api.config,{forced_login_method:'api',model_provider:'openai'});
 assert.throws(()=>codexAuthentication({CODEX_AUTH_MODE:'api-key'}),/API Key/);
 assert.throws(()=>codexAuthentication({CODEX_AUTH_MODE:'unknown'}),/认证模式/);
});
test('subscription providers read their isolated directories within the project auth volume',()=>{
 const claude=buildAgentEnvironment({provider:'claude',authMode:'subscription',apiKey:'ignored',baseUrl:'https://ignored.example.com',model:''});
 assert.ok(claude.includes('PRISM_AGENT_PROVIDER=claude-sub'));
 assert.ok(claude.includes('AGENT_TYPE=claude-sub'));
 assert.ok(claude.includes('CLAUDE_CONFIG_DIR=/project-auth/claude'));
 assert.ok(!claude.some(value=>value.includes('ignored')));
 const glm=buildAgentEnvironment({provider:'glm',authMode:'subscription',apiKey:'plan-key',baseUrl:'',model:''});
 assert.ok(glm.includes('PRISM_AGENT_PROVIDER=glm'));
 assert.ok(glm.includes('XDG_CONFIG_HOME=/project-auth/glm'));
 assert.ok(glm.includes('PRISM_AUTH_MODE=subscription'));
 assert.ok(!glm.some(value=>value.includes('plan-key')));
});

test("container entrypoint defaults to Claude and explicitly passes --provider", () => {
  const directory = mkdtempSync(path.join(tmpdir(),"prism-sdk-test-"));
  const entrypoint = readFileSync(new URL("../docker/entrypoint.sh",import.meta.url),"utf8");
  const launch = entrypoint.slice(entrypoint.indexOf("# 9. Start Agent Server"));
  const stub = 'set -e\ncd() { :; }\nlog_main() { cat; }\nnode() { printf "%s\\n" "$@" > "$CAPTURE_FILE"; }\n';
  try {
    for (const [configured,legacy,expected] of [["","","claude"],["glm","claude","glm"],["claude","glm","claude"],["","glm","glm"],["codex","claude","codex"]]) {
      const capture = path.join(directory,"args");
      execFileSync("bash",["-c",stub+launch],{env:{...process.env,PRISM_AGENT_PROVIDER:configured,AGENT_TYPE:legacy,LOG_DIR:directory,CAPTURE_FILE:capture}});
      const args = readFileSync(capture,"utf8").trim().split("\n");
      assert.deepEqual(args.slice(-2),["--provider",expected]);
    }
    assert.throws(() => execFileSync("bash",["-c",stub+launch],{stdio:"pipe",env:{...process.env,PRISM_AGENT_PROVIDER:"invalid",LOG_DIR:directory}}));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
