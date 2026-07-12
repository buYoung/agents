import * as prompts from "@clack/prompts";
import { TUI_CANCEL, type TuiAdapter, type TuiOption, type TuiSpinner } from "@cli/types";

function mapOptions<T extends string>(options: TuiOption<T>[]) {
  return options.map((option) => ({
    value: option.value,
    label: option.label,
    hint: option.hint,
    disabled: option.disabled,
  }));
}

function toResult<T>(value: T): T | typeof TUI_CANCEL {
  return prompts.isCancel(value) ? TUI_CANCEL : value;
}

/** 실제 실행용 Clack 경계다. 스트림/키 입력 테스트는 이 객체를 대체해 수행한다. */
export const clackTui: TuiAdapter = {
  intro: prompts.intro,
  outro: prompts.outro,
  cancel: prompts.cancel,
  note: prompts.note,
  async select<T extends string>(message: string, options: TuiOption<T>[]) {
    return toResult(await prompts.select({ message, options: mapOptions(options) as never })) as T | typeof TUI_CANCEL;
  },
  async multiselect<T extends string>(message: string, options: TuiOption<T>[]) {
    return toResult(await prompts.multiselect({ message, options: mapOptions(options) as never, required: true })) as T[] | typeof TUI_CANCEL;
  },
  async confirm(message: string) {
    return toResult(await prompts.confirm({ message })) as boolean | typeof TUI_CANCEL;
  },
  spinner(): TuiSpinner {
    return prompts.spinner();
  },
};

export function finishCancelled(tui: TuiAdapter): void {
  tui.cancel("작업을 취소했습니다. 파일은 변경하지 않았습니다.");
  tui.outro("취소됨");
}
