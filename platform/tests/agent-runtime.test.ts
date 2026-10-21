import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildAgentEnvironment } from "../src/services/agent-runtime.js";

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

test("container entrypoint defaults to Claude and explicitly passes --provider", () => {
  const directory = mkdtempSync(path.join(tmpdir(),"prism-sdk-test-"));
  const entrypoint = readFileSync(new URL("../docker/entrypoint.sh",import.meta.url),"utf8");
  const launch = entrypoint.slice(entrypoint.indexOf("# 9. Start Agent Server"));
  const stub = 'set -e\ncd() { :; }\nlog_main() { cat; }\nnode() { printf "%s\\n" "$@" > "$CAPTURE_FILE"; }\n';
  try {
    for (const [configured,legacy,expected] of [["","","claude"],["glm","claude","glm"],["claude","glm","claude"],["","glm","glm"]]) {
      const capture = path.join(directory,"args");
      execFileSync("bash",["-c",stub+launch],{env:{...process.env,PRISM_AGENT_PROVIDER:configured,AGENT_TYPE:legacy,LOG_DIR:directory,CAPTURE_FILE:capture}});
      const args = readFileSync(capture,"utf8").trim().split("\n");
      assert.deepEqual(args.slice(-2),["--provider",expected]);
    }
    assert.throws(() => execFileSync("bash",["-c",stub+launch],{stdio:"pipe",env:{...process.env,PRISM_AGENT_PROVIDER:"invalid",LOG_DIR:directory}}));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
