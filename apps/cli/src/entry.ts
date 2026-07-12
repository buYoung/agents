import { pathToFileURL } from "node:url";
import { runCli } from "@cli/cli";

/** 현재 프로세스 인수를 CLI에 전달하고 결과 종료 코드를 보존한다. */
export function runCliFromProcess(): void {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCliFromProcess();
}
