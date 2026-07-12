import { TUI_CANCEL, type LifecyclePlanItem, type LifecycleTarget, type OpencodeScope, type TuiAdapter } from "@cli/types";

export interface InteractiveSelection {
  targets: LifecycleTarget[];
  scope?: OpencodeScope;
  /** 관리 기록이 없는 기존 파일은 대화형에서 명시적으로 안내한 뒤 가져온다. */
  adopt: boolean;
}

/** --target이 생략된 대화형 install/update/backup의 대상과 OpenCode 범위를 고른다. */
export async function selectLifecycleTargets(tui: TuiAdapter): Promise<InteractiveSelection | null> {
  const selected = await tui.multiselect("처리할 대상을 선택하세요.", [
    { value: "codex", label: "Codex", hint: "Codex agent와 skill" },
    { value: "opencode", label: "OpenCode", hint: "OpenCode plugin과 설정" },
  ]);
  if (selected === TUI_CANCEL || selected.length === 0) return null;
  const targets = selected as LifecycleTarget[];
  let scope: OpencodeScope | undefined;
  if (targets.includes("opencode")) {
    const selectedScope = await tui.select("OpenCode 설치 위치를 선택하세요.", [
      { value: "user", label: "사용자 전체", hint: "사용자 설정 디렉터리" },
      { value: "project", label: "현재 프로젝트", hint: ".opencode 아래" },
    ]);
    if (selectedScope === TUI_CANCEL) return null;
    scope = selectedScope;
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

/** 실제 파일 변경 전에 대상별 상태·설치/사용 가능 버전·예정 작업을 보여주고 승인받는다. */
export async function confirmLifecyclePlan(
  tui: TuiAdapter,
  operation: "install" | "update",
  plan: LifecyclePlanItem[],
): Promise<boolean | null> {
  const details = plan.map((item) => {
    const inspection = item.inspection;
    const name = inspection.target === "codex" ? "Codex" : `OpenCode (${inspection.scope})`;
    return [
      `${name}`,
      `현재 상태: ${inspection.status}${inspection.reason ? ` — ${inspection.reason}` : ""}`,
      `설치 버전: ${inspection.installedVersion ?? "없음"}`,
      `사용 가능 버전: ${inspection.availableVersion ?? "확인 불가"}`,
      `예정 작업: ${operationMessage(item)}`,
    ].join("\n");
  }).join("\n\n");
  tui.note(details, `${operation === "install" ? "설치" : "업데이트"} 전 확인`);
  const answer = await tui.confirm("표시한 계획을 실행하시겠습니까?");
  return answer === TUI_CANCEL ? null : answer;
}
