import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { CliIO, LifecyclePlanItem, LifecycleTarget, OpencodeScope } from "@cli/types";

export interface InteractiveSelection {
  targets: LifecycleTarget[];
  scope?: OpencodeScope;
  /** 관리 기록이 없는 기존 파일은 대화형에서 명시적으로 안내한 뒤 가져온다. */
  adopt: boolean;
}

export async function readTerminalLine(question: string): Promise<string> {
  const terminal = readline.createInterface({ input: stdin, output: stdout });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

async function choose(
  io: Required<CliIO>,
  title: string,
  options: readonly string[],
): Promise<number | null> {
  io.stdout(title);
  options.forEach((option, index) => io.stdout(`  ${index + 1}. ${option}`));
  io.stdout("  0. 취소");
  let answer: string;
  try {
    answer = (await io.readLine("선택 번호: ")).trim();
  } catch {
    io.stdout("입력이 종료되어 작업을 취소했습니다. 파일은 변경하지 않았습니다.");
    return null;
  }
  if (answer === "0" || answer.toLowerCase() === "q") return null;
  const choice = Number(answer);
  if (!Number.isInteger(choice) || choice < 1 || choice > options.length) {
    io.stderr("선택 번호가 올바르지 않습니다. 작업을 시작하지 않았습니다.");
    return null;
  }
  return choice - 1;
}

/** --target이 생략된 대화형 install/update의 대상과 OpenCode 범위를 선택한다. */
export async function selectLifecycleTargets(io: Required<CliIO>): Promise<InteractiveSelection | null> {
  const targetChoice = await choose(io, "처리할 대상을 선택하세요.", ["Codex", "OpenCode", "Codex와 OpenCode 모두"]);
  if (targetChoice === null) return null;
  const targets: LifecycleTarget[] = targetChoice === 0 ? ["codex"] : targetChoice === 1 ? ["opencode"] : ["codex", "opencode"];
  let scope: OpencodeScope | undefined;
  if (targets.includes("opencode")) {
    const scopeChoice = await choose(io, "OpenCode 설치 위치를 선택하세요.", ["사용자 전체", "현재 프로젝트"]);
    if (scopeChoice === null) return null;
    scope = scopeChoice === 0 ? "user" : "project";
  }
  return { targets, scope, adopt: true };
}

function operationMessage(item: LifecyclePlanItem): string {
  const { status } = item.inspection;
  if (status === "unmanaged") return "CLI 관리 밖 파일이 있습니다. 계속하면 기존 설정을 보관한 뒤 가져와 새 방식으로 설치합니다.";
  if (item.resolvedOperation === "install") return "설치되지 않아 새로 설치합니다.";
  if (item.resolvedOperation === "update") return "설치되어 있어 새 버전으로 업데이트합니다.";
  if (item.resolvedOperation === "rebuild") return "너무 오래된 설치라 사용자 설정을 보존하고 새 방식으로 다시 설치합니다.";
  if (item.resolvedOperation === "repair") return "일부 파일이 손상되어 사용자 설정을 보존하고 복구 설치합니다.";
  if (item.resolvedOperation === "verify") return status === "ahead" ? "배포판보다 새 버전이라 변경하지 않고 현재 상태만 확인합니다." : "최신 상태라 변경하지 않고 적용 상태만 확인합니다.";
  return "변경할 파일이 없습니다.";
}

/** 실제 파일 변경 전에 대상별 상태와 결정된 작업을 알리고 확인한다. */
export async function confirmLifecyclePlan(
  io: Required<CliIO>,
  operation: "install" | "update",
  plan: LifecyclePlanItem[],
): Promise<boolean> {
  io.stdout(`${operation === "install" ? "설치" : "업데이트"} 전 확인:`);
  for (const item of plan) {
    const displayName = item.inspection.target === "codex" ? "Codex" : "OpenCode";
    io.stdout(`- ${displayName}: ${operationMessage(item)}`);
    if (item.inspection.reason) io.stdout(`  현재 상태: ${item.inspection.reason}`);
  }
  let answer: string;
  try {
    answer = (await io.readLine("계속하시겠습니까? [y/N]: ")).trim().toLowerCase();
  } catch {
    io.stdout("입력이 종료되어 작업을 취소했습니다. 파일은 변경하지 않았습니다.");
    return false;
  }
  return answer === "y" || answer === "yes" || answer === "예";
}
