import { isJsonObject } from "@cli/fs-utils";

export function stripJsoncComments(content: string): string {
  let output = "";
  let isInString = false;
  let isEscaped = false;
  let isInLineComment = false;
  let isInBlockComment = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (isInLineComment) {
      if (character === "\n" || character === "\r") {
        isInLineComment = false;
        output += character;
      }
      continue;
    }

    if (isInBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        isInBlockComment = false;
        index += 1;
      } else if (character === "\n" || character === "\r") {
        output += character;
      }
      continue;
    }

    if (isInString) {
      output += character;
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === "\"") {
        isInString = false;
      }
      continue;
    }

    if (character === "\"") {
      isInString = true;
      output += character;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      isInLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      isInBlockComment = true;
      index += 1;
      continue;
    }

    output += character;
  }

  return output;
}

export function removeJsoncTrailingCommas(content: string): string {
  let output = "";
  let isInString = false;
  let isEscaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (isInString) {
      output += character;
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === "\"") {
        isInString = false;
      }
      continue;
    }

    if (character === "\"") {
      isInString = true;
      output += character;
      continue;
    }

    if (character === ",") {
      let lookaheadIndex = index + 1;
      while (/\s/.test(content[lookaheadIndex] ?? "")) {
        lookaheadIndex += 1;
      }
      if (content[lookaheadIndex] === "}" || content[lookaheadIndex] === "]") {
        continue;
      }
    }

    output += character;
  }

  return output;
}

export function parseJsoncObject(
  configPath: string,
  content: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(removeJsoncTrailingCommas(stripJsoncComments(content)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${configPath} 파싱 실패: ${message}`);
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`${configPath}는 JSON object여야 합니다.`);
  }
  return parsed;
}
