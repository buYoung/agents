#!/usr/bin/env node
import { getBundledCatalogPath } from "opencode/core";
import {
  EXIT_BLOCKED,
  EXIT_INTERNAL,
  EXIT_VALID,
  GITHUB_RELEASE_BASE,
} from "@cli/constants";
import type { CliIO } from "@cli/types";
import { notifyUpgradeIfAvailable } from "@cli/release";
import { install } from "@cli/commands/install";
import { uninstall } from "@cli/commands/uninstall";
import { validate } from "@cli/commands/validate";
import { doctor } from "@cli/commands/doctor";
import { update } from "@cli/commands/update";
import { upgrade } from "@cli/commands/upgrade";

function printHelp(stdout: (line: string) => void): void {
  stdout(
    "사용법: agents <install|uninstall|validate|doctor|update|upgrade> [options]",
  );
  stdout("명령: install, uninstall, validate, doctor, update, upgrade");
}

export async function runCli(argv: string[], io: CliIO = {}): Promise<number> {
  const resolvedIO: Required<CliIO> = {
    cwd: io.cwd ?? process.cwd(),
    env: io.env ?? process.env,
    stdout: io.stdout ?? ((line) => console.log(line)),
    stderr: io.stderr ?? ((line) => console.error(line)),
  };
  const [command, ...args] = argv;
  try {
    if (!command || command === "--help" || command === "-h") {
      printHelp(resolvedIO.stdout);
      await notifyUpgradeIfAvailable(resolvedIO);
      return command ? EXIT_VALID : EXIT_BLOCKED;
    }
    await notifyUpgradeIfAvailable(resolvedIO);
    switch (command) {
      case "install":
        return await install(args, resolvedIO);
      case "uninstall":
        return await uninstall(args, resolvedIO);
      case "validate":
        return await validate(args, resolvedIO);
      case "doctor":
        return await doctor(args, resolvedIO);
      case "update":
        return await update(args, resolvedIO);
      case "upgrade":
        return await upgrade(args, resolvedIO);
      default:
        resolvedIO.stderr(`알 수 없는 명령: ${command}`);
        printHelp(resolvedIO.stderr);
        return EXIT_BLOCKED;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resolvedIO.stderr(`internal-error: ${message}`);
    return EXIT_INTERNAL;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

export const CLI_COMMANDS = [
  "install",
  "uninstall",
  "validate",
  "doctor",
  "update",
  "upgrade",
] as const;
export const RELEASE_BASE_PREFIX = GITHUB_RELEASE_BASE;
export const BUNDLED_CATALOG_PATH = getBundledCatalogPath();
