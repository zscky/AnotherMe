"""
Voice agent: generate per-step narration audio with Edge TTS.
集成 Teaching Narration Skills 提升讲解质量。
"""

import asyncio
import subprocess
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

import edge_tts

from ..foundation.base_agent import BaseAgent
from ..perception.vision_tool import VisionTool
try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR

try:
    from ..planning.teaching_narration_skills import (
        get_narration_skill_engine,
        NarrationContext,
    )
    NARRATION_SKILLS_AVAILABLE = True
except ImportError:
    NARRATION_SKILLS_AVAILABLE = False


class VoiceAgent(BaseAgent):
    """Generate narration audio for script steps with teaching quality enhancement."""

    SYSTEM_PROMPT = """你负责把数学讲解旁白润色成适合 TTS 播放的版本。
要求：
1. 更口语化，但不要改变数学含义。
2. 句子自然，避免过长。
3. 保留关键几何对象和结论。
4. 输出纯文本。"""

    SYSTEM_PROMPT_WITH_SKILLS = """你是一位专业的数学教师，负责生成高质量的几何教学讲解。

术语规范（必须严格遵守）：
- 折叠相关：使用"折痕"（不用"折叠线"）、"像点"（不用"对称点"）、"原像"、"翻折"
- 点相关：顶点、端点、垂足、圆心、切点
- 线相关：线段、直线、射线、垂线、中线、角平分线
- 关系相关：垂直、平行、相交、重合、共线

讲解要求：
1. 循序渐进，逻辑清晰，不要跳跃
2. 关键概念首次出现时要简要解释
3. 使用"因为...所以..."展示推理过程
4. 配合视觉，明确指示图形元素（点A、线段AB、三角形ABC）
5. 语气友好，鼓励学生思考
6. 句子长度适中（15-25字为宜），适合语音播报
7. 重要结论要重复强调

输出要求：
- 只输出讲解文本
- 不要添加标记、编号或解释
- 确保术语统一准确"""

    def __init__(
        self,
        config: Dict[str, Any],
        llm: Optional[Any] = None,
        vision_tool: Optional[VisionTool] = None,
    ):
        super().__init__(config, llm)
        # 根据配置选择是否使用增强的 skill-based prompt
        self.use_narration_skills = bool(config.get("use_narration_skills", True))
        if self.use_narration_skills and NARRATION_SKILLS_AVAILABLE:
            self.system_prompt = config.get("system_prompt", self.SYSTEM_PROMPT_WITH_SKILLS)
            self._narration_engine = get_narration_skill_engine()
        else:
            self.system_prompt = config.get("system_prompt", self.SYSTEM_PROMPT)
            self._narration_engine = None
        self.voice_name = config.get("voice", "zh-CN-XiaoxiaoNeural")
        self.rate = config.get("rate", "+30%")
        self.volume = config.get("volume", "+10%")
        self.optimize_narration_with_llm = bool(config.get("optimize_narration_with_llm", True))
        raw_tts_concurrency = config.get("tts_concurrency", 3)
        try:
            parsed_tts_concurrency = int(raw_tts_concurrency)
        except (TypeError, ValueError):
            parsed_tts_concurrency = 3
            print(f"[VoiceAgent] 无效 tts_concurrency={raw_tts_concurrency!r}，已回退为 3")
        self.tts_concurrency = max(1, parsed_tts_concurrency)
        raw_llm_concurrency = config.get("narration_optimization_concurrency", self.tts_concurrency)
        try:
            parsed_llm_concurrency = int(raw_llm_concurrency)
        except (TypeError, ValueError):
            parsed_llm_concurrency = self.tts_concurrency
        self.narration_optimization_concurrency = max(1, parsed_llm_concurrency)
        raw_fallback_ratio = config.get("max_silent_fallback_ratio", 1.0)
        try:
            parsed_fallback_ratio = float(raw_fallback_ratio)
        except (TypeError, ValueError):
            parsed_fallback_ratio = 1.0
        self.max_silent_fallback_ratio = max(0.0, min(parsed_fallback_ratio, 1.0))

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        project = state["project"]
        if getattr(project, "status", "") == "failed":
            return state

        script_steps = project.script_steps
        if not script_steps:
            state["messages"].append(
                {
                    "role": "assistant",
                    "content": "没有脚本步骤，无法生成讲解音频。",
                }
            )
            return state

        print("\n[VoiceAgent] 开始生成音频...")
        voice_style = self._resolve_voice_style(state)
        active_rate = str(voice_style.get("rate", self.rate) or self.rate)
        active_volume = str(voice_style.get("volume", self.volume) or self.volume)

        if self.optimize_narration_with_llm and self.llm is not None:
            optimized_narrations = asyncio.run(self._optimize_narrations_async(script_steps, voice_style=voice_style))
        else:
            optimized_narrations = [str(getattr(step, "narration", "") or "").strip() for step in script_steps]

        output_dir = Path(self.config.get("output_dir", str(DEFAULT_OUTPUT_DIR))) / "audio"
        output_dir.mkdir(parents=True, exist_ok=True)

        audio_paths = [output_dir / f"narration_{i + 1:03d}.mp3" for i in range(len(optimized_narrations))]
        tts_success_flags = asyncio.run(
            self._generate_tts_batch(
                optimized_narrations,
                audio_paths,
                rate=active_rate,
                volume=active_volume,
            )
        )

        tts_files: List[str] = []
        fallback_audio_count = 0
        for i, audio_path in enumerate(audio_paths):
            success = bool(tts_success_flags[i]) if i < len(tts_success_flags) else False

            if success:
                duration = self._get_audio_duration(str(audio_path))
                if duration is None or duration <= 0:
                    print(f"[VoiceAgent] ✗ 音频 {i + 1} 文件无效，已跳过")
                    self._delete_if_exists(audio_path)
                    success = False
                else:
                    tts_files.append(str(audio_path))
                    script_steps[i].audio_file = str(audio_path)
                    script_steps[i].audio_duration = duration
                    print(f"[VoiceAgent] ✓ 音频 {i + 1} 生成成功")
                    continue

            fallback_audio = audio_path.with_suffix(".wav")
            fallback_duration = self._resolve_step_duration(script_steps[i])
            fallback_ok = self._create_silent_wav(fallback_audio, fallback_duration)
            if fallback_ok and self._is_valid_audio_file(fallback_audio):
                actual_duration = self._get_audio_duration(str(fallback_audio)) or fallback_duration
                script_steps[i].audio_file = str(fallback_audio)
                script_steps[i].audio_duration = actual_duration
                tts_files.append(str(fallback_audio))
                fallback_audio_count += 1
                print(f"[VoiceAgent] ! 音频 {i + 1} 使用静音兜底：{fallback_audio}")
            else:
                script_steps[i].audio_file = None
                script_steps[i].audio_duration = None
                print(f"[VoiceAgent] ✗ 音频 {i + 1} 生成失败")

        merged_audio = None
        if tts_files and all(Path(audio).suffix.lower() == ".mp3" for audio in tts_files):
            merged_audio = self._merge_audio_files(tts_files, output_dir / "merged_narration.mp3")
            project.audio_merged_file = merged_audio
            if merged_audio:
                print(f"[VoiceAgent] 音频合并完成：{merged_audio}")
        else:
            project.audio_merged_file = None

        fallback_ratio = (fallback_audio_count / max(len(script_steps), 1)) if script_steps else 0.0
        metadata = state.setdefault("metadata", {})
        metadata["voice_fallback_ratio"] = round(fallback_ratio, 4)

        project.tts_audio_files = tts_files
        project.total_duration = self._estimate_total_duration(script_steps, project.total_duration)
        missing_audio_steps = [
            int(getattr(step, "id", index + 1) or (index + 1))
            for index, step in enumerate(script_steps)
            if not str(getattr(step, "audio_file", "") or "").strip()
        ]
        if missing_audio_steps:
            project.status = "failed"
            project.error_message = (
                "Narration audio missing for script steps: "
                + ", ".join(str(item) for item in missing_audio_steps)
            )
            state["project"] = project
            state["current_step"] = "voice_failed"
            state["messages"].append(
                {
                    "role": "assistant",
                    "content": (
                        "讲解音频生成失败：以下步骤未生成有效音频 "
                        + ", ".join(str(item) for item in missing_audio_steps)
                    ),
                }
            )
            return state

        if fallback_ratio >= self.max_silent_fallback_ratio and fallback_audio_count > 0:
            project.status = "failed"
            project.error_message = (
                "TTS unavailable for all narration segments; "
                f"silent fallback ratio={fallback_ratio:.2f}"
            )
            state["project"] = project
            state["current_step"] = "voice_failed"
            state["messages"].append(
                {
                    "role": "assistant",
                    "content": (
                        "讲解音频生成失败："
                        f"静音兜底比例 {fallback_ratio:.2f} 超过阈值 {self.max_silent_fallback_ratio:.2f}。"
                    ),
                }
            )
            return state

        state["project"] = project
        state["current_step"] = "voice_completed"
        state["messages"].append(
            {
                "role": "assistant",
                "content": (
                    f"讲解音频生成完成，共 {len(tts_files)} 段。"
                    f"静音兜底 {fallback_audio_count} 段。"
                    f"静音占比 {fallback_ratio:.2f}。"
                    f"语速={active_rate}。"
                ),
            }
        )
        return state

    def _estimate_total_duration(self, steps: List[Any], fallback_total: Any) -> float:
        total = 0.0
        counted = 0
        for step in steps:
            raw = getattr(step, "audio_duration", None)
            if raw is None:
                raw = getattr(step, "duration", None)
            try:
                val = float(raw)
            except (TypeError, ValueError):
                val = 0.0
            if val > 0:
                total += val
                counted += 1

        if counted > 0 and total > 0:
            return round(total, 2)

        try:
            fallback = float(fallback_total)
        except (TypeError, ValueError):
            fallback = 0.0
        return round(max(0.0, fallback), 2)

    def _optimize_narrations(self, steps: List[Any], voice_style: Optional[Dict[str, Any]] = None) -> List[str]:
        print("[VoiceAgent] 优化旁白文案...")
        narrations: List[str] = []
        for step in steps:
            user_prompt = self._build_narration_prompt(
                narration=str(getattr(step, "narration", "") or ""),
                voice_style=voice_style,
            )
            messages = self._format_messages(
                system_prompt=self.system_prompt,
                user_prompt=user_prompt,
            )
            fallback_text = str(getattr(step, "narration", "") or "").strip()
            try:
                response_content = self._invoke_llm(messages)
                narrations.append((response_content or "").strip() or fallback_text)
            except Exception as exc:
                print(f"[VoiceAgent] 旁白优化失败，使用原文：{exc}")
                narrations.append(fallback_text)
        return narrations

    async def _optimize_narrations_async(
        self,
        steps: List[Any],
        voice_style: Optional[Dict[str, Any]] = None,
    ) -> List[str]:
        print("[VoiceAgent] 并发优化旁白文案...")
        semaphore = asyncio.Semaphore(self.narration_optimization_concurrency)
        narrations: List[str] = [""] * len(steps)

        async def _run_one(index: int, step: Any) -> None:
            fallback_text = str(getattr(step, "narration", "") or "").strip()
            
            # 提取步骤上下文用于 narration skill
            step_context = self._extract_step_context(step, index)
            
            user_prompt = self._build_narration_prompt(
                narration=fallback_text,
                voice_style=voice_style,
                step_context=step_context,
            )
            messages = self._format_messages(
                system_prompt=self.system_prompt,
                user_prompt=user_prompt,
            )
            try:
                async with semaphore:
                    response_content = await asyncio.to_thread(self._invoke_llm, messages)
                optimized = (response_content or "").strip()
                
                # 如果使用了 narration skills，进行术语标准化
                if self.use_narration_skills and self._narration_engine is not None and optimized:
                    optimized = self._narration_engine.apply_terminology_standard(optimized)
                
                narrations[index] = optimized or fallback_text
            except Exception as exc:
                print(f"[VoiceAgent] 第 {index + 1} 段旁白优化失败，回退原文：{exc}")
                narrations[index] = fallback_text

        await asyncio.gather(*[_run_one(i, step) for i, step in enumerate(steps)])
        return narrations

    async def _generate_tts_batch(
        self,
        texts: List[str],
        audio_paths: List[Path],
        *,
        rate: str,
        volume: str,
    ) -> List[bool]:
        semaphore = asyncio.Semaphore(self.tts_concurrency)
        results: List[bool] = [False] * len(texts)

        async def _run_one(index: int, text: str, audio_path: Path) -> None:
            print(f"[VoiceAgent] 生成第 {index + 1} 段音频...")
            async with semaphore:
                results[index] = await self._generate_tts(
                    text,
                    str(audio_path),
                    rate=rate,
                    volume=volume,
                )

        await asyncio.gather(
            *[_run_one(i, text, audio_paths[i]) for i, text in enumerate(texts)]
        )
        return results

    async def _generate_tts(
        self,
        text: str,
        output_path: str,
        *,
        rate: Optional[str] = None,
        volume: Optional[str] = None,
    ) -> bool:
        max_retries = 3
        output = Path(output_path)
        for attempt in range(max_retries):
            try:
                communicate = edge_tts.Communicate(
                    text=text,
                    voice=self.voice_name,
                    rate=str(rate or self.rate),
                    volume=str(volume or self.volume),
                )
                await communicate.save(str(output))
                if not self._is_valid_audio_file(output):
                    raise ValueError(f"TTS output is empty or invalid: {output}")
                return True
            except Exception as exc:
                self._delete_if_exists(output)
                if attempt < max_retries - 1:
                    print(f"Edge TTS 重试 {attempt + 1}/{max_retries}: {exc}")
                    await asyncio.sleep(1)
                else:
                    print(f"Edge TTS 最终失败: {exc}")
                    return False
        return False

    def _get_audio_duration(self, audio_path: str) -> Optional[float]:
        try:
            path = Path(audio_path)
            if not self._is_valid_audio_file(path):
                return None
            if path.suffix.lower() == ".wav":
                with wave.open(str(path), "rb") as wav_file:
                    frame_rate = wav_file.getframerate()
                    frame_count = wav_file.getnframes()
                    if frame_rate <= 0:
                        return None
                    return float(frame_count) / float(frame_rate)

            from mutagen import File as MutagenFile

            audio = MutagenFile(str(path))
            if audio is None or getattr(audio, "info", None) is None:
                return None
            length = getattr(audio.info, "length", None)
            return float(length) if length else None
        except Exception as exc:
            print(f"获取音频时长失败：{exc}")
            return None

    def _is_valid_audio_file(self, audio_path: Path | str) -> bool:
        try:
            path = Path(audio_path)
            if not path.exists() or path.stat().st_size <= 0:
                return False
            if path.suffix.lower() == ".wav":
                with wave.open(str(path), "rb") as wav_file:
                    frame_rate = wav_file.getframerate()
                    frame_count = wav_file.getnframes()
                    return bool(frame_rate > 0 and frame_count > 0)

            from mutagen import File as MutagenFile

            audio = MutagenFile(str(path))
            if audio is None or getattr(audio, "info", None) is None:
                return False
            return bool(getattr(audio.info, "length", 0) and audio.info.length > 0)
        except Exception:
            return False

    def _resolve_step_duration(self, step: Any) -> float:
        raw_duration = (
            getattr(step, "audio_duration", None)
            or getattr(step, "duration", None)
            or 0
        )
        try:
            parsed = float(raw_duration)
        except (TypeError, ValueError):
            parsed = 0.0
        return parsed if parsed > 0 else 1.0

    def _create_silent_wav(self, output_path: Path, duration: float) -> bool:
        try:
            safe_duration = max(0.5, float(duration))
            sample_rate = 16000
            total_frames = int(sample_rate * safe_duration)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(output_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(b"\x00\x00" * total_frames)
            return True
        except Exception as exc:
            print(f"创建静音兜底音频失败：{exc}")
            self._delete_if_exists(output_path)
            return False

    def _merge_audio_files(self, audio_files: List[str], output_path: Path) -> Optional[str]:
        try:
            valid_audio_files = [audio for audio in audio_files if self._is_valid_audio_file(audio)]
            if not valid_audio_files:
                return None

            list_file = output_path.with_suffix(".txt")
            with open(list_file, "w", encoding="utf-8") as handle:
                for audio_file in valid_audio_files:
                    abs_path = Path(audio_file).resolve()
                    escaped_path = str(abs_path).replace("\\", "/")
                    handle.write(f"file '{escaped_path}'\n")

            result = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(list_file),
                    "-c",
                    "copy",
                    str(output_path),
                ],
                capture_output=True,
                text=True,
                timeout=60,
            )
            self._delete_if_exists(list_file)

            if result.returncode == 0 and output_path.exists() and output_path.stat().st_size > 0:
                return str(output_path)

            print(f"ffmpeg 合并音频失败：{result.stderr}")
            self._delete_if_exists(output_path)
            return None
        except Exception as exc:
            print(f"合并音频失败：{exc}")
            self._delete_if_exists(output_path)
            return None

    def _delete_if_exists(self, path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass

    def _resolve_voice_style(self, state: Dict[str, Any]) -> Dict[str, Any]:
        raw_metadata = state.get("metadata")
        metadata: Dict[str, Any] = raw_metadata if isinstance(raw_metadata, dict) else {}

        raw_adaptive_plan = metadata.get("adaptive_plan")
        adaptive_plan: Dict[str, Any] = raw_adaptive_plan if isinstance(raw_adaptive_plan, dict) else {}

        raw_tts_profile = adaptive_plan.get("tts_profile")
        tts_profile: Dict[str, Any] = raw_tts_profile if isinstance(raw_tts_profile, dict) else {}

        return {
            "rate": str(tts_profile.get("rate", self.rate) or self.rate),
            "volume": str(tts_profile.get("volume", self.volume) or self.volume),
            "pause_style": str(tts_profile.get("pause_style", "normal") or "normal"),
            "mode": str(adaptive_plan.get("mode", "standard") or "standard"),
        }

    def _build_narration_prompt(
        self,
        narration: str,
        voice_style: Optional[Dict[str, Any]] = None,
        step_context: Optional[Dict[str, Any]] = None,
    ) -> str:
        style = voice_style or {}
        mode = str(style.get("mode", "standard") or "standard")
        pause_style = str(style.get("pause_style", "normal") or "normal")
        step_context = step_context or {}

        # 如果使用 narration skills，构建增强 prompt
        if self.use_narration_skills and self._narration_engine is not None:
            return self._build_enhanced_narration_prompt(
                narration=narration,
                voice_style=voice_style,
                step_context=step_context,
            )

        # 基础 prompt（不使用 skills）
        extra_rules = ""
        if mode == "remedial":
            extra_rules = (
                "补充要求：句子更短，关键结论用两句话表达；"
                "在'所以/因此/结论是'前后增加自然停顿感。"
            )
        elif mode == "advanced":
            extra_rules = "补充要求：节奏紧凑，减少重复表述，但保持逻辑完整。"

        return (
            "请把下面这段几何讲解润色成适合中文 TTS 播放的旁白。\n"
            "要求：自然、清晰、不要改变数学含义、不要输出解释。\n"
            f"当前语音风格：mode={mode}, pause_style={pause_style}。\n"
            f"{extra_rules}\n\n"
            f"{narration}"
        )

    def _build_enhanced_narration_prompt(
        self,
        narration: str,
        voice_style: Optional[Dict[str, Any]] = None,
        step_context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        使用 Teaching Narration Skills 构建增强的讲解 prompt
        """
        style = voice_style or {}
        step_context = step_context or {}

        # 构建 narration context
        context = NarrationContext(
            step_type=step_context.get("step_type", "explanation"),
            problem_pattern=step_context.get("problem_pattern", ""),
            geometry_objects=step_context.get("geometry_objects", []),
            action_sequence=step_context.get("action_sequence", []),
            audience_level=str(style.get("audience", "middle_school")),
            language_style=str(style.get("mode", "formal")),
        )

        # 获取增强的 prompt
        enhanced = self._narration_engine.build_enhanced_prompt(context)

        # 添加具体的讲解内容
        return f"""{enhanced}

=== 原始讲解内容 ===
{narration}

=== 任务 ===
请根据以上术语规范和讲解结构，将原始讲解内容润色成高质量的教学讲解。
要求输出纯文本，不要添加标记或解释。
"""

    def _extract_step_context(self, step: Any, step_index: int) -> Dict[str, Any]:
        """
        从步骤中提取上下文信息用于 narration skill
        """
        context: Dict[str, Any] = {
            "step_type": "explanation",
            "problem_pattern": "",
            "geometry_objects": [],
            "action_sequence": [],
        }

        # 提取步骤类型
        narration = str(getattr(step, "narration", "") or "").lower()
        actions = getattr(step, "actions", []) or []

        # 判断是否为折叠步骤
        if any("fold" in str(a).lower() for a in actions):
            context["step_type"] = "fold"
            context["problem_pattern"] = "fold_transform"
        elif any("proof" in narration or "证明" in narration for a in actions):
            context["step_type"] = "proof"

        # 提取几何对象
        import re
        points = re.findall(r'点[\s]*([A-Z][0-9]*)', str(getattr(step, "narration", "")))
        segments = re.findall(r'线段[\s]*([A-Z]{2})', str(getattr(step, "narration", "")))
        context["geometry_objects"] = points + segments

        # 提取动作序列
        context["action_sequence"] = [str(a) for a in actions]

        return context
