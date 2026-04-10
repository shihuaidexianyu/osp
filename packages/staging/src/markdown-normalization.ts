export function normalizeStagedMarkdown(markdownSource: string): string {
  return mapMarkdownSegmentsOutsideFences(markdownSource, normalizePlainTextSegment);
}

function normalizePlainTextSegment(markdownSource: string): string {
  const normalizedParenthesizedMath = normalizeParenthesizedDisplayMath(markdownSource);
  const normalizedBracketMath = normalizeBracketMath(normalizedParenthesizedMath);

  return canonicalizeDisplayMathBlocks(normalizedBracketMath);
}

const PARENTHESIZED_MATH_LIMIT = 10_000;

function normalizeParenthesizedDisplayMath(markdownSource: string): string {
  if (markdownSource.length > PARENTHESIZED_MATH_LIMIT) {
    return markdownSource;
  }

  return markdownSource.replace(/([（(])\s*\$\$\s*([\s\S]*?)\s*\$\$\s*([)）])/gu, (match, leftParen, body, rightParen) => {
    if (!isMatchingParenPair(leftParen, rightParen)) {
      return match;
    }

    const normalizedBody = collapseInlineMathWhitespace(body);

    if (normalizedBody === "") {
      return match;
    }

    return `$${normalizedBody}$`;
  });
}

function normalizeBracketMath(markdownSource: string): string {
  const normalizedDisplayMath = markdownSource.replace(/\\\[\s*([\s\S]*?)\s*\\\]/gu, (_match, body: string) => {
    return createDisplayMathBlock(body);
  });

  return normalizedDisplayMath
    .split(/\r?\n/u)
    .map((line) =>
      replaceOutsideInlineCode(line, /\\\(\s*([^()\r\n]+?)\s*\\\)/gu, (_match, body: string) => {
        const normalizedBody = collapseInlineMathWhitespace(body);
        return normalizedBody === "" ? _match : `$${normalizedBody}$`;
      })
    )
    .join("\n");
}

function canonicalizeDisplayMathBlocks(markdownSource: string): string {
  const normalizedSingleLineBlocks = markdownSource
    .split(/\r?\n/u)
    .flatMap((line) => normalizeSingleLineDisplayMathLine(line));
  const normalizedLines: string[] = [];

  for (let index = 0; index < normalizedSingleLineBlocks.length; index += 1) {
    const currentLine = normalizedSingleLineBlocks[index];

    if (currentLine === undefined || currentLine.trim() !== "$$") {
      if (currentLine !== undefined) {
        normalizedLines.push(currentLine);
      }
      continue;
    }

    const closingIndex = findClosingDisplayMathIndex(normalizedSingleLineBlocks, index + 1);

    if (closingIndex === -1) {
      normalizedLines.push(currentLine);
      continue;
    }

    const bodyLines = trimSurroundingBlankLines(normalizedSingleLineBlocks.slice(index + 1, closingIndex)).map((line) =>
      line.trimEnd()
    );

    normalizedLines.push("$$");

    if (bodyLines.length > 0) {
      normalizedLines.push(...bodyLines);
    }

    normalizedLines.push("$$");
    index = closingIndex;
  }

  return normalizedLines.join("\n");
}

function normalizeSingleLineDisplayMathLine(line: string): string[] {
  const trimmedLine = line.trim();
  const match = /^\$\$\s*(.+?)\s*\$\$$/u.exec(trimmedLine);

  if (match === null) {
    return [line];
  }

  const normalizedBody = match[1]?.trim();

  if (normalizedBody === undefined || normalizedBody === "") {
    return [line];
  }

  return ["$$", normalizedBody, "$$"];
}

function findClosingDisplayMathIndex(lines: string[], startIndex: number): number {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "$$") {
      return index;
    }
  }

  return -1;
}

function trimSurroundingBlankLines(lines: string[]): string[] {
  let startIndex = 0;
  let endIndex = lines.length;

  while (startIndex < endIndex && isBlankLine(lines[startIndex])) {
    startIndex += 1;
  }

  while (endIndex > startIndex && isBlankLine(lines[endIndex - 1])) {
    endIndex -= 1;
  }

  return lines.slice(startIndex, endIndex);
}

function isBlankLine(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

function createDisplayMathBlock(body: string): string {
  const trimmedBody = body
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  return trimmedBody === "" ? "$$\n$$" : `$$\n${trimmedBody}\n$$`;
}

function collapseInlineMathWhitespace(body: string): string {
  return body.replace(/\s+/gu, " ").trim();
}

function isMatchingParenPair(leftParen: string, rightParen: string): boolean {
  return (leftParen === "(" && rightParen === ")") || (leftParen === "（" && rightParen === "）");
}

function replaceOutsideInlineCode(
  line: string,
  pattern: RegExp,
  replacer: (match: string, ...captures: string[]) => string
): string {
  return line
    .split(/(`+[^`]*`+)/u)
    .map((segment) => (segment.startsWith("`") ? segment : segment.replace(pattern, replacer)))
    .join("");
}

function mapMarkdownSegmentsOutsideFences(
  markdownSource: string,
  transformPlainText: (segment: string) => string
): string {
  const lines = markdownSource.split(/\r?\n/u);
  const output: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  let plainTextStartIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index] ?? "";
    const fence = readFenceMarker(currentLine);

    if (!inFence && fence !== undefined) {
      pushPlainTextSegment(output, lines.slice(plainTextStartIndex, index), transformPlainText);
      output.push(currentLine);
      inFence = true;
      fenceMarker = fence;
      plainTextStartIndex = index + 1;
      continue;
    }

    if (inFence && fence === fenceMarker) {
      output.push(...lines.slice(plainTextStartIndex, index), currentLine);
      inFence = false;
      fenceMarker = "";
      plainTextStartIndex = index + 1;
    }
  }

  const trailingLines = lines.slice(plainTextStartIndex);

  if (inFence) {
    output.push(...trailingLines);
    return output.join("\n");
  }

  pushPlainTextSegment(output, trailingLines, transformPlainText);
  return output.join("\n");
}

function pushPlainTextSegment(
  output: string[],
  lines: string[],
  transformPlainText: (segment: string) => string
): void {
  if (lines.length === 0) {
    return;
  }

  output.push(...transformPlainText(lines.join("\n")).split("\n"));
}

function readFenceMarker(line: string): string | undefined {
  const match = /^\s*(```+|~~~+)/u.exec(line);

  return match?.[1];
}
