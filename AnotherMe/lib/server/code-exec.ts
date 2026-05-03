/**
 * Code Execution Server-side Logic
 *
 * 执行 Python 代码的安全沙箱 - 服务端内部调用版本
 * - 临时目录执行
 * - 超时控制
 * - 受限环境变量
 * - 输出截断
 * - 仅支持标准库 + 常见数学/数据包
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';

const log = createLogger('CodeExecServer');
const execFileAsync = promisify(execFile);

// 允许导入的模块白名单
const ALLOWED_IMPORTS = new Set([
  'math', 'random', 'statistics', 'fractions', 'decimal', 'numbers',
  'json', 'csv', 'datetime', 'time', 'calendar', 'itertools', 'functools',
  'collections', 'heapq', 'bisect', 'copy', 'pprint', 'string', 're',
  'hashlib', 'base64', 'binascii', 'struct',
  'typing', 'abc', 'dataclasses', 'enum', 'pathlib',
  'numpy', 'pandas', 'matplotlib', 'scipy', 'sympy',
]);

// 禁止的函数调用
const DISALLOWED_CALLS = new Set([
  'open', 'exec', 'eval', 'compile', '__import__', 'input', 'breakpoint',
  'exit', 'quit', 'help', 'license', 'copyright', 'credits',
  'getattr', 'setattr', 'delattr', 'hasattr',  // 动态属性访问绕过
  'globals', 'locals', 'vars',  // 访问命名空间
  'dir',  // 枚举对象属性
]);

// 禁止的模块访问
const DISALLOWED_MODULES = new Set([
  'os', 'sys', 'subprocess', 'socket', 'urllib', 'http', 'ftplib',
  'smtplib', 'imaplib', 'poplib', 'telnetlib', 'shutil', 'importlib',
  'builtins', 'types', 'inspect',
]);

export interface CodeExecutionRequest {
  code: string;
  timeout?: number;
  language?: 'python';
}

export interface CodeExecutionResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
}

/**
 * 简单的 AST 检查（通过正则表达式，因为无法在前端使用 Python 的 ast 模块）
 * 这是一个基本的检查，生产环境应该使用更严格的沙箱
 */
function validateCode(code: string): { valid: boolean; error?: string } {
  // 检查禁止的函数调用
  for (const call of DISALLOWED_CALLS) {
    const regex = new RegExp(`\\b${call}\\s*\\(`, 'g');
    if (regex.test(code)) {
      return { valid: false, error: `禁止使用函数: ${call}` };
    }
  }

  // 检查禁止的模块访问
  for (const mod of DISALLOWED_MODULES) {
    // 匹配 module.function 或 from module import
    const regex1 = new RegExp(`\\b${mod}\\.`, 'g');
    const regex2 = new RegExp(`from\\s+${mod}\\b`, 'gi');
    const regex3 = new RegExp(`import\\s+${mod}\\b`, 'gi');

    if (regex1.test(code) || regex2.test(code) || regex3.test(code)) {
      return { valid: false, error: `禁止访问模块: ${mod}` };
    }
  }

  // Enforce a conservative import allowlist. This catches modules that are not
  // explicitly dangerous but still inappropriate for a tutoring code sandbox.
  const importRegex = /^\s*import\s+(.+)$/gim;
  for (const match of code.matchAll(importRegex)) {
    const modules = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/i)[0]?.trim())
      .filter(Boolean);

    for (const moduleName of modules) {
      const root = moduleName!.split('.')[0];
      if (!ALLOWED_IMPORTS.has(moduleName!) && !ALLOWED_IMPORTS.has(root)) {
        return { valid: false, error: `禁止导入模块: ${moduleName}` };
      }
    }
  }

  const fromImportRegex = /^\s*from\s+([a-zA-Z_][\w.]*)\s+import\s+/gim;
  for (const match of code.matchAll(fromImportRegex)) {
    const moduleName = match[1];
    const root = moduleName.split('.')[0];
    if (!ALLOWED_IMPORTS.has(moduleName) && !ALLOWED_IMPORTS.has(root)) {
      return { valid: false, error: `禁止导入模块: ${moduleName}` };
    }
  }

  // 检查危险模式（使用大小写不敏感匹配）
  const dangerousPatterns = [
    { pattern: /__\w+__/i, desc: '双下划线属性' },
    { pattern: /\.\s*__\w+/i, desc: '访问 __ 属性' },
    { pattern: /while\s*\(\s*1\s*\)/i, desc: '无限循环 (while(1))' },
    { pattern: /while\s+True\b/i, desc: '无限循环 (while True)' },
    { pattern: /for\s+\w+\s+in\s+iter\s*\(/i, desc: '无限循环 (iter)' },
    { pattern: /for\s+\w+\s+in\s+itertools\.count\s*\(/i, desc: '无限循环 (itertools.count)' },
    { pattern: /\bgetattr\s*\(/i, desc: '动态属性访问 (getattr)' },
    { pattern: /\bsetattr\s*\(/i, desc: '动态属性设置 (setattr)' },
    { pattern: /\bdelattr\s*\(/i, desc: '动态属性删除 (delattr)' },
    { pattern: /\bhasattr\s*\(/i, desc: '属性检查 (hasattr)' },
    { pattern: /\bglobals\s*\(/i, desc: '访问全局命名空间 (globals)' },
    { pattern: /\blocals\s*\(/i, desc: '访问局部命名空间 (locals)' },
    { pattern: /\bvars\s*\(/i, desc: '访问对象字典 (vars)' },
    { pattern: /\bdir\s*\(/i, desc: '枚举对象属性 (dir)' },
    { pattern: /\\x[0-9a-f]{2}/i, desc: '十六进制转义字符' },
    { pattern: /\\u[0-9a-f]{4}/i, desc: 'Unicode转义字符绕过' },
    { pattern: /chr\s*\(\s*\d+\s*\)/, desc: 'chr() 字符构造' },
    { pattern: /\bbytes\s*\.\s*fromhex/i, desc: 'bytes.fromhex 绕过' },
    { pattern: /\bbytearray\s*\(/i, desc: 'bytearray 构造' },
  ];

  for (const { pattern, desc } of dangerousPatterns) {
    if (pattern.test(code)) {
      return { valid: false, error: `代码包含危险模式: ${desc}` };
    }
  }

  // 检测字符串拼接绕过尝试 (如 'ex' + 'ec', '__im' + 'port__')
  const stringConcatPattern = /['"][^'"]*['"]\s*\+\s*['"][^'"]*['"]/g;
  const concatMatches = code.match(stringConcatPattern);
  if (concatMatches) {
    for (const match of concatMatches) {
      const combined = match.replace(/['"\s+]/g, '');
      const dangerousStrings = ['exec', 'eval', 'import', 'open', 'compile', 
        '__import__', '__builtins__', 'getattr', 'setattr', 'os', 'sys', 'subprocess'];
      for (const dangerous of dangerousStrings) {
        if (combined.toLowerCase().includes(dangerous.toLowerCase())) {
          return { valid: false, error: `检测到字符串拼接绕过尝试: ${dangerous}` };
        }
      }
    }
  }

  // 检测格式化字符串绕过 (如 f"{chr(101)}xec")
  if (/f['"].*\{.*chr.*\}.*['"]/.test(code)) {
    return { valid: false, error: '检测到格式化字符串绕过尝试' };
  }

  // 检测 join 方法构造危险字符串
  if (/['"].*['"]\s*\.\s*join\s*\(/.test(code)) {
    const joinPattern = /['"]([^'"]*)['"]\s*\.\s*join\s*\(\s*\[([^\]]*)\]\s*\)/g;
    const joinMatches = code.matchAll(joinPattern);
    for (const match of joinMatches) {
      const separator = match[1];
      const parts = match[2].replace(/['"]/g, '').split(',').map(s => s.trim());
      const result = parts.join(separator);
      const dangerousStrings = ['exec', 'eval', 'import', 'open', 'compile', '__import__'];
      for (const dangerous of dangerousStrings) {
        if (result.toLowerCase().includes(dangerous.toLowerCase())) {
          return { valid: false, error: `检测到 join 方法绕过尝试: ${dangerous}` };
        }
      }
    }
  }

  return { valid: true };
}

/**
 * 执行 Python 代码
 * 服务端内部调用版本
 */
export async function executePythonCode(
  request: CodeExecutionRequest,
): Promise<CodeExecutionResponse> {
  const startTime = Date.now();
  const { code, timeout = 30 } = request;
  const timeoutSec = Math.min(Math.max(Number(timeout) || 30, 1), 60);
  const pythonCandidates = [
    process.env.PYTHON_BIN,
    process.env.PYTHON,
    'python3',
    'python',
  ].filter((candidate): candidate is string => Boolean(candidate));

  try {
    // 验证输入
    if (!code || typeof code !== 'string') {
      return {
        success: false,
        stdout: '',
        stderr: '缺少代码参数',
        exitCode: -1,
        executionTime: 0,
        error: '缺少代码参数',
      };
    }

    if (code.length > 10000) {
      return {
        success: false,
        stdout: '',
        stderr: '代码长度超过限制 (10000 字符)',
        exitCode: -1,
        executionTime: 0,
        error: '代码长度超过限制 (10000 字符)',
      };
    }

    // 代码安全检查
    const validation = validateCode(code);
    if (!validation.valid) {
      return {
        success: false,
        stdout: '',
        stderr: `安全验证失败: ${validation.error}`,
        exitCode: -1,
        executionTime: 0,
        error: `安全验证失败: ${validation.error}`,
      };
    }

    // 创建临时目录
    const execId = randomUUID();
    const execDir = join(tmpdir(), 'anotherme-code-exec', execId);
    await mkdir(execDir, { recursive: true });

    // 写入代码文件
    const codeFile = join(execDir, 'script.py');
    await writeFile(codeFile, code, 'utf-8');

    // 设置环境变量（受限环境）
    const env: NodeJS.ProcessEnv = {
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PATH: process.env.PATH || '',
      NODE_ENV: process.env.NODE_ENV || 'production',
      // 不传递其他环境变量
    };

    // 执行代码
    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    try {
      let lastExecError: unknown;

      for (const pythonBin of pythonCandidates) {
        try {
          const { stdout: out, stderr: err } = await execFileAsync(
            pythonBin,
            ['-I', codeFile],
            {
              timeout: timeoutSec * 1000,
              env,
              cwd: execDir,
              maxBuffer: 1024 * 1024, // 1MB 输出限制
              windowsHide: true,
            },
          );
          stdout = out;
          stderr = err;
          lastExecError = undefined;
          break;
        } catch (candidateError) {
          lastExecError = candidateError;
          const err = candidateError as NodeJS.ErrnoException;
          if (err.code === 'ENOENT') {
            continue;
          }
          throw candidateError;
        }
      }

      if (lastExecError) {
        throw lastExecError;
      }
    } catch (execError) {
      if (execError instanceof Error) {
        const execErr = execError as Error & {
          stdout?: string;
          stderr?: string;
          killed?: boolean;
          signal?: string;
          code?: string | number;
        };

        // 检查是否是超时
        if (execError.message.includes('timeout') || execErr.killed || execErr.signal === 'SIGTERM') {
          stderr = `执行超时 (${timeoutSec} 秒)`;
          exitCode = -1;
        } else if (execErr.code === 'ENOENT') {
          stderr = '未找到 Python 运行时。请安装 Python，或设置 PYTHON_BIN 环境变量。';
          exitCode = -1;
        } else {
          stderr = execError.message;
          exitCode = 1;
        }

        // 获取 stdout/stderr（如果有）
        if (execErr.stdout) stdout = execErr.stdout;
        if (execErr.stderr) stderr = execErr.stderr;
      }
    }

    // 截断输出
    const MAX_OUTPUT = 10000;
    if (stdout.length > MAX_OUTPUT) {
      stdout = stdout.slice(0, MAX_OUTPUT) + '\n... (输出已截断)';
    }
    if (stderr.length > MAX_OUTPUT) {
      stderr = stderr.slice(0, MAX_OUTPUT) + '\n... (错误输出已截断)';
    }

    // 清理临时目录
    try {
      await rm(execDir, { recursive: true, force: true });
    } catch (cleanupError) {
      log.warn('Failed to cleanup execution directory:', cleanupError);
    }

    const executionTime = Date.now() - startTime;

    log.info(`Code execution completed: ${execId}, exitCode=${exitCode}, time=${executionTime}ms`);

    return {
      success: exitCode === 0,
      stdout,
      stderr,
      exitCode,
      executionTime,
    };

  } catch (error) {
    log.error('Code execution error:', error);
    return {
      success: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : '执行失败',
      exitCode: -1,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '执行失败',
    };
  }
}
