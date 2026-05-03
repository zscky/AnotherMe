"""
Main entry point for generating a math-solution video from an image.
"""

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

sys.path.insert(0, str(Path(__file__).parent))

from env_loader import load_project_env

from agents.foundation.config import (
    TEXT_API_KEY_ENV_NAME,
    VISION_API_KEY_ENV_NAME,
    build_default_llm_config,
    build_ocr_model_config,
    build_vision_model_config,
)
from agents.foundation.state import AgentState, VideoProject
from agents.orchestration.workflow import create_default_workflow
try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


class MathVideoGenerator:
    """Generate a math-solution video from a problem image."""

    def __init__(
        self,
        llm_config: Optional[Dict[str, Any]] = None,
        vision_config: Optional[Dict[str, Any]] = None,
        ocr_vision_config: Optional[Dict[str, Any]] = None,
    ):
        self.llm_config = llm_config or build_default_llm_config()
        self.vision_config = vision_config or build_vision_model_config()
        self.ocr_vision_config = ocr_vision_config or build_ocr_model_config()
        self.workflow = None

    def generate(
        self,
        image_path: str,
        problem_text: Optional[str] = None,
        output_dir: str = str(DEFAULT_OUTPUT_DIR),
        geometry_file: Optional[str] = None,
        export_ggb: bool = True,
        learner_memory: Optional[Dict[str, Any]] = None,
    ) -> str:
        self.workflow = create_default_workflow(
            llm_config=self.llm_config,
            vision_llm_config=self.vision_config,
            ocr_llm_config=self.ocr_vision_config,
            output_dir=output_dir,
            export_ggb=export_ggb,
        )

        initial_state: AgentState = {
            "project": VideoProject(
                problem_text=problem_text or "",
                problem_image=image_path,
                geometry_file=geometry_file,
                export_ggb=export_ggb,
            ),
            "messages": [],
            "current_step": "start",
            "metadata": {
                "geometry_file": geometry_file,
                "export_ggb": export_ggb,
                "learner_memory": learner_memory if isinstance(learner_memory, dict) else {},
            },
        }

        print("=" * 60)
        print("Starting math video generation")
        print("=" * 60)
        print(f"Image: {image_path}")
        if geometry_file:
            print(f"Geometry file: {geometry_file}")
        if problem_text:
            print(f"Problem text: {problem_text}")
        print("=" * 60)

        final_state = self.workflow.invoke(initial_state)
        project = final_state["project"]

        print("\n" + "=" * 60)
        print("Generation finished")
        print("=" * 60)
        print(f"Status: {project.status}")
        print(f"Script steps: {len(project.script_steps)}")
        print(f"Total duration: {project.total_duration:.1f}s")
        if project.final_video_path:
            print(f"Output: {project.final_video_path}")
        if project.error_message:
            print(f"Error: {project.error_message}")

        return project.final_video_path or ""


def _resolve_api_key() -> str:
    return (
        os.getenv(TEXT_API_KEY_ENV_NAME)
        or os.getenv(VISION_API_KEY_ENV_NAME)
        or os.getenv("QWEN_API_KEY")
        or os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("BAILIAN_API_KEY")
        or os.getenv("ARK_API_KEY")
        or ""
    )


def main():
    load_project_env()

    parser = argparse.ArgumentParser(
        description="Generate a math-solution video from a problem image.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python main.py --image problem.png\n"
            "  python main.py --image problem.png --output_dir ./generated_outputs/default_run\n"
            "  python main.py --image problem.png --api_key sk-xxx\n"
        ),
    )

    parser.add_argument(
        "--image",
        "-i",
        type=str,
        required=True,
        help="Path to the problem image.",
    )
    parser.add_argument(
        "--problem",
        "-p",
        type=str,
        default=None,
        help="Optional problem text. If omitted, OCR/vision will extract it from the image.",
    )
    parser.add_argument(
        "--output_dir",
        "-o",
        type=str,
        default=str(DEFAULT_OUTPUT_DIR),
        help="Output directory.",
    )
    parser.add_argument(
        "--geometry-file",
        type=str,
        default=None,
        help="Optional coordinate-scene JSON file.",
    )
    parser.add_argument(
        "--export-ggb",
        dest="export_ggb",
        action="store_true",
        default=True,
        help="Export GeoGebra debug commands.",
    )
    parser.add_argument(
        "--no-export-ggb",
        dest="export_ggb",
        action="store_false",
        help="Disable GeoGebra debug export.",
    )
    parser.add_argument(
        "--api_key",
        type=str,
        default=None,
        help="API key for DashScope/Bailian or Ark.",
    )

    args = parser.parse_args()

    if args.api_key:
        os.environ[TEXT_API_KEY_ENV_NAME] = args.api_key
        os.environ[VISION_API_KEY_ENV_NAME] = args.api_key
        os.environ.setdefault("ARK_API_KEY", args.api_key)

    if not _resolve_api_key():
        print("Error: missing API key.")
        print("Use one of these options:")
        print("  1. --api_key your_api_key")
        print("  2. Set DASHSCOPE_API_KEY")
        print("  3. Set BAILIAN_API_KEY")
        print("  4. Set QWEN_API_KEY")
        print("  5. Set ARK_API_KEY")
        sys.exit(1)

    if not Path(args.image).exists():
        print(f"Error: image file not found: {args.image}")
        sys.exit(1)

    if args.geometry_file and not Path(args.geometry_file).exists():
        print(f"Error: geometry file not found: {args.geometry_file}")
        sys.exit(1)

    generator = MathVideoGenerator(
        llm_config=build_default_llm_config(),
        vision_config=build_vision_model_config(),
        ocr_vision_config=build_ocr_model_config(),
    )

    result = generator.generate(
        image_path=args.image,
        problem_text=args.problem,
        output_dir=args.output_dir,
        geometry_file=args.geometry_file,
        export_ggb=args.export_ggb,
    )

    if result:
        output_suffix = Path(result).suffix.lower()
        if output_suffix == ".mp4":
            print(f"\nVideo generated: {result}")
        elif output_suffix in {".mp3", ".wav", ".m4a"}:
            print(f"\nRender fell back to audio output: {result}")
        else:
            print(f"\nOutput generated: {result}")
    else:
        print("\nGeneration failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
