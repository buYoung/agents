import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  agentsSourceDirectory,
  fixturePath,
  repositoryRoot,
  smokePermissionProfile,
  smokePermissionProfileName,
  orchestratorSkillSourceDirectory,
  userCodexHome,
} from "./configuration.mjs";

function copyDirectory(sourceDirectory, targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true });
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function copyFileIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function prepareCodexHome(temporaryCodexHome) {
  fs.mkdirSync(temporaryCodexHome, { recursive: true });
  copyFileIfExists(path.join(userCodexHome, "auth.json"), path.join(temporaryCodexHome, "auth.json"),);
  copyFileIfExists(path.join(userCodexHome, "config.toml"), path.join(temporaryCodexHome, "config.toml"),);
  copyFileIfExists(path.join(userCodexHome, "models_cache.json"), path.join(temporaryCodexHome, "models_cache.json"),);
  copyDirectory(agentsSourceDirectory, path.join(temporaryCodexHome, "agents"));
  copyDirectory(orchestratorSkillSourceDirectory, path.join(temporaryCodexHome, "skills", "codex-orchestrator"),);
  fs.writeFileSync(path.join(temporaryCodexHome, `${ smokePermissionProfileName }.config.toml`), smokePermissionProfile, "utf-8",);
}

function prepareWorkspace(temporaryWorkspace) {
  fs.copyFileSync(
      path.join(repositoryRoot, "AGENTS.md"),
      path.join(temporaryWorkspace, "AGENTS.md"),
  );
  copyDirectory(
      agentsSourceDirectory,
      path.join(temporaryWorkspace, ".codex", "agents"),
  );
  fs.copyFileSync(fixturePath, path.join(temporaryWorkspace, "fixtures.md"));
  copyDirectory(
      path.join(repositoryRoot, "packages", "opencode", "src"),
      path.join(temporaryWorkspace, "packages", "opencode", "src"),
  );
  copyDirectory(
      path.join(repositoryRoot, "packages", "codex", "agents"),
      path.join(temporaryWorkspace, "packages", "codex", "agents"),
  );
  fs.mkdirSync(path.join(temporaryWorkspace, ".agents", "orchestration"), {
    recursive: true,
  });
}

function codexExecArgs({ caseName, prompt, temporaryWorkspace }) {
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--profile",
    smokePermissionProfileName,
    "--skip-git-repo-check",
    "--cd",
    temporaryWorkspace,
    "-c",
    "suppress_unstable_features_warning=true",
  ];

  if (caseName === "no-mcp") {
    args.push(
        "-c",
        'mcp_servers.codemap_search.command="codemap-search"',
        "-c",
        'mcp_servers.codemap_search.args=["mcp"]',
        "-c",
        "mcp_servers.codemap_search.enabled=false",
        "-c",
        'mcp_servers."codemap-search".command="codemap-search"',
        "-c",
        'mcp_servers."codemap-search".args=["mcp"]',
        "-c",
        'mcp_servers."codemap-search".enabled=false',
    );
  } else if (caseName === "mcp") {
    args.push(
        "-c",
        'mcp_servers.codemap_search.command="codemap-search"',
        "-c",
        'mcp_servers.codemap_search.args=["mcp"]',
        "-c",
        "mcp_servers.codemap_search.startup_timeout_sec=20",
        "-c",
        "mcp_servers.codemap_search.tool_timeout_sec=60",
        "-c",
        "mcp_servers.codemap_search.required=true",
    );
  }

  args.push(prompt);
  return args;
}

function codexExecResumeArgs({ prompt, sessionId }) {
  return [
    "exec",
    "resume",
    "--json",
    "--skip-git-repo-check",
    "-c",
    "suppress_unstable_features_warning=true",
    sessionId,
    prompt,
  ];
}

function runCodexExec({ args, cwd, env, timeoutSeconds }) {
  return new Promise((resolve) => {
    const child = spawn("codex", args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5000).unref();
    }, timeoutSeconds * 1000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      settled = true;
      resolve({
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.stack ?? error.message}`,
        exitCode: null,
        signal: null,
        timedOut,
        spawnError: error.message,
      });
    });

    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      settled = true;
      resolve({ stdout, stderr, exitCode, signal, timedOut });
    });
  });
}


function runChildProcess(command, args, cwd, input) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (input) child.stdin.end(input);
    child.on("error", (error) => resolve({ exitCode: null, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

export {
  codexExecArgs,
  codexExecResumeArgs,
  copyDirectory,
  copyFileIfExists,
  prepareCodexHome,
  prepareWorkspace,
  runChildProcess,
  runCodexExec,
};
