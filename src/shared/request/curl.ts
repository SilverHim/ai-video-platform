/** 生成等价 curl 命令（Key 用环境变量占位，绝不内联） */

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface CurlInput {
  method: string;
  url: string;
  body?: unknown;
  stream?: boolean;
  /** 例如 ARK_API_KEY / MINIMAX_API_KEY */
  keyEnvVar: string;
  /** 请求体超过该字节数时改用 -d @request.json */
  inlineLimit?: number;
}

export function toCurl(input: CurlInput): { command: string; bodyFile?: string } {
  const lines = [`curl ${input.stream ? '-N ' : ''}-X ${input.method} ${shQuote(input.url)}`];
  lines.push(`  -H "Authorization: Bearer $${input.keyEnvVar}"`);
  let bodyFile: string | undefined;
  if (input.body !== undefined) {
    lines.push(`  -H 'Content-Type: application/json'`);
    const json = JSON.stringify(input.body, null, 2);
    if (json.length > (input.inlineLimit ?? 100_000)) {
      bodyFile = json;
      lines.push('  -d @request.json');
    } else {
      lines.push(`  --data-raw ${shQuote(json)}`);
    }
  }
  return { command: lines.join(' \\\n'), ...(bodyFile !== undefined ? { bodyFile } : {}) };
}
