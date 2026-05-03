/**
 * Code Execution API Route
 *
 * 执行 Python 代码的安全沙箱 - HTTP API 包装器
 * 实际执行逻辑在 lib/server/code-exec.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { executePythonCode, type CodeExecutionRequest } from '@/lib/server/code-exec';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body: CodeExecutionRequest = await request.json();
  const result = await executePythonCode(body);

  if (
    result.error &&
    result.exitCode === -1 &&
    /参数|超过限制|安全验证失败|禁止/.test(result.stderr)
  ) {
    return NextResponse.json(result, { status: 400 });
  }

  if (result.error && result.exitCode === -1 && result.stderr.includes('未找到 Python')) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
