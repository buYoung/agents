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
import { backup } from "@cli/commands/backup";
import { restore } from "@cli/commands/restore";
import { status } from "@cli/commands/status";
import { isJsonFormat, isKeyValueFormat } from "@cli/diagnostic-result";
import { clackTui } from "@cli/tui";

function printHelp(stdout: (line: string) => void): void {
  stdout(
    "사용법: agents <install|uninstall|update|backup|restore|doctor|upgrade> [options]",
  );
  stdout("명령: install, uninstall, update, backup, restore, doctor, upgrade");
  stdout("진단: `agents doctor`로 설정, 설치 상태, 실행 준비를 한 번에 확인합니다.");
  stdout("대상: install/update/uninstall/backup/restore는 --target codex|opencode|all을 지원합니다.");
  stdout("install/update에서 --target을 생략하면 대화형 터미널에서 대상과 OpenCode 설치 위치를 고릅니다.");
}

export async function runCli(argv: string[], io: CliIO = {}): Promise<number> {
  const resolvedIO: Required<CliIO> = {
    cwd: io.cwd ?? process.cwd(),
    env: io.env ?? process.env,
    stdout: io.stdout ?? ((line) => console.log(line)),
    stderr: io.stderr ?? ((line) => console.error(line)),
    isInteractive: io.isInteractive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
    tui: io.tui ?? clackTui,
  };
  const [command, ...args] = argv;
  try {
    if (!command || command === "--help" || command === "-h") {
      printHelp(resolvedIO.stdout);
      await notifyUpgradeIfAvailable(resolvedIO);
      return command ? EXIT_VALID : EXIT_BLOCKED;
    }
    // 대상 선택을 취소하거나 입력이 끝난 경우에는 배포 목록조차 읽지 않는다.
    // 대화형 install/update는 대상 선택 뒤 명령 안에서 필요한 목록만 읽는다.
    const defersVersionNotice =
      (command === "install" || command === "update") &&
      resolvedIO.isInteractive &&
      !args.includes("--target");
    const usesMachineOutput = isJsonFormat(args) || isKeyValueFormat(args);
    const suppressVersionNotice =
      usesMachineOutput && ["doctor", "status", "validate", "backup", "restore"].includes(command);
    if (!defersVersionNotice && !suppressVersionNotice) await notifyUpgradeIfAvailable(resolvedIO);
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
      case "backup":
        return await backup(args, resolvedIO);
      case "restore":
        return await restore(args, resolvedIO);
      case "status":
        return await status(args, resolvedIO);
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

export const CLI_COMMANDS = [
  "install",
  "uninstall",
  "validate",
  "doctor",
  "update",
  "upgrade",
  "backup",
  "restore",
  "status",
] as const;
export const RELEASE_BASE_PREFIX = GITHUB_RELEASE_BASE;
export const BUNDLED_CATALOG_PATH = getBundledCatalogPath();
