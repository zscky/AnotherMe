import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, readdir, rm, writeFile, copyFile, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import type { CapabilityToolResult, RenderedArtifact } from './types';

const execFileAsync = promisify(execFile);

export interface RenderManimParams {
  code: string;
  sceneName?: string;
  quality?: 'low' | 'medium' | 'high';
  timeoutSec?: number;
}

function stripCodeFence(code: string): string {
  const trimmed = code.trim();
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown };
    if (typeof parsed.code === 'string') {
      return normalizeManimCode(parsed.code);
    }
  } catch {
    // Ignore non-JSON responses; model output is often plain Python.
  }

  const fenced = trimmed.match(/```(?:python|py)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;
  return normalizeManimCode(candidate
    .replace(/^```python\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim());
}

function normalizeManimCode(code: string): string {
  return code
    .replace(/\r\n/g, '\n')
    .replace(/,\s*stroke_dash_pattern\s*=\s*(?:\[[^\]]*\]|\([^)]*\)|[^,\)\n]+)/g, '')
    .replace(/stroke_dash_pattern\s*=\s*(?:\[[^\]]*\]|\([^)]*\)|[^,\)\n]+),\s*/g, '')
    .split('\n')
    .filter((line) => !/^\s*self\.save_state\(\)\s*$/.test(line))
    .join('\n')
    .trim();
}

function inferSceneName(code: string): string {
  const match = code.match(/class\s+([A-Za-z_]\w*)\s*\(\s*[^)]*Scene[^)]*\)\s*:/);
  return match?.[1] || 'GeneratedScene';
}

function validateManimCode(code: string): string | null {
  if (!code.trim()) return 'Manim 代码为空';
  if (!/\bfrom\s+manim\s+import\b|\bimport\s+manim\b/.test(code)) {
    return 'Manim 代码需要导入 manim';
  }
  if (!/class\s+[A-Za-z_]\w*\s*\(\s*[^)]*Scene[^)]*\)\s*:/.test(code)) {
    return 'Manim 代码需要包含 Scene 子类';
  }
  if (/^\s*(?:from|import)\s+(?:os|subprocess|socket|shutil)\b/m.test(code)) {
    return 'Manim 代码包含不允许的系统模块';
  }
  return null;
}

async function findRenderedVideo(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const videos = entries
    .filter((entry) => {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.mp4')) return false;
      return !entry.parentPath.split(path.sep).includes('partial_movie_files');
    })
    .map((entry) => path.join(entry.parentPath, entry.name));
  const candidates = videos.length > 0
    ? videos
    : entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
        .map((entry) => path.join(entry.parentPath, entry.name));

  if (candidates.length === 0) return null;
  const resolved = await Promise.all(candidates.map(async (filePath) => ({
    filePath,
    mtimeMs: (await stat(filePath)).mtimeMs,
  })));
  return resolved.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

export async function renderManim(params: RenderManimParams): Promise<CapabilityToolResult<{ artifact?: RenderedArtifact; sceneName: string }>> {
  const code = stripCodeFence(params.code);
  const validationError = validateManimCode(code);
  const sceneName = params.sceneName || inferSceneName(code);

  if (validationError) {
    return {
      success: false,
      toolId: 'manim_render',
      output: '',
      error: validationError,
      metadata: { sceneName },
    };
  }

  const condaEnv = process.env.MANIM_CONDA_ENV || 'AnotherMe';
  const manimBin = process.env.MANIM_BIN || process.env.CONDA_EXE || 'conda';
  const manimArgs = process.env.MANIM_BIN ? [] : ['run', '-n', condaEnv, 'manim'];
  const jobId = randomUUID();
  const workDir = path.join(tmpdir(), 'anotherme-manim', jobId);
  const publicDir = path.join(process.cwd(), 'public', 'generated', 'manim');
  const mediaDir = path.join(workDir, 'media');
  const scriptPath = path.join(workDir, 'scene.py');
  const quality = params.quality === 'high' ? '-qh' : params.quality === 'medium' ? '-qm' : '-ql';
  const timeoutMs = Math.min(Math.max(params.timeoutSec || 120, 10), 600) * 1000;

  await mkdir(workDir, { recursive: true });
  await mkdir(mediaDir, { recursive: true });
  await mkdir(publicDir, { recursive: true });

  try {
    await writeFile(scriptPath, code, 'utf-8');
    const args = [
      ...manimArgs,
      quality,
      scriptPath,
      sceneName,
      '--media_dir',
      mediaDir,
      '--progress_bar',
      'none',
      '--format',
      'mp4',
    ];
    const { stdout, stderr } = await execFileAsync(
      manimBin,
      args,
      {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 8,
        windowsHide: true,
      },
    );

    const renderedPath = await findRenderedVideo(workDir);
    if (!renderedPath) {
      return {
        success: false,
        toolId: 'manim_render',
        output: stdout || stderr || '',
        error: 'Manim 执行完成但未找到 mp4 输出',
        metadata: { sceneName },
      };
    }

    const fileName = `${jobId}.mp4`;
    const targetPath = path.join(publicDir, fileName);
    await copyFile(renderedPath, targetPath);

    return {
      success: true,
      toolId: 'manim_render',
      output: 'Manim 视频渲染完成',
      metadata: {
        sceneName,
        artifact: {
          format: 'mp4',
          url: `/generated/manim/${fileName}`,
          path: targetPath,
          mimeType: 'video/mp4',
        },
      },
    };
  } catch (error) {
    const err = error as Error & { code?: string; stdout?: string; stderr?: string };
    const missingBinary = err.code === 'ENOENT';
    const processOutput = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    return {
      success: false,
      toolId: 'manim_render',
      output: processOutput,
      error: missingBinary
        ? '未找到 manim 或 conda 可执行文件。请安装 Manim，或设置 MANIM_BIN / CONDA_EXE / MANIM_CONDA_ENV。'
        : processOutput || err.message,
      metadata: { sceneName },
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
