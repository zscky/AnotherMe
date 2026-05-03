"""
使用示例
"""
import os
from main import MathVideoGenerator
from agents.foundation.config import DEFAULT_LLM_CONFIG, VISION_MODEL_CONFIG

# 设置 API 密钥（从环境变量获取）
# os.environ["ARK_API_KEY"] = "your_api_key_here"


def example_1_simple():
    """示例 1: 最简单 - 只传图片"""
    generator = MathVideoGenerator()

    # 一张图就够了！自动识别题目并生成视频
    result = generator.generate(
        image_path="./problem.png"
    )

    print(f"输出文件：{result}")


def example_2_with_text():
    """示例 2: 图片 + 手动指定题目（跳过 OCR）"""
    generator = MathVideoGenerator()

    result = generator.generate(
        image_path="./problem.png",
        problem_text="在 Rt△ABC 中，∠C=90°, BC=6cm, AC=8cm..."
    )

    print(f"输出文件：{result}")


def example_3_programmatic():
    """示例 3: 程序化调用（在代码中使用）"""
    from agents.orchestration.workflow import create_default_workflow
    from agents.foundation.state import AgentState, VideoProject

    # 创建工作流
    workflow = create_default_workflow(
        llm_config=DEFAULT_LLM_CONFIG,
        vision_llm_config=VISION_MODEL_CONFIG
    )

    # 初始化状态
    initial_state = {
        "project": VideoProject(
            problem_image="./problem.png"
        ),
        "messages": [],
        "current_step": "start",
        "metadata": {}
    }

    # 执行
    final_state = workflow.invoke(initial_state)

    # 获取结果
    project = final_state["project"]
    print(f"题目识别：{project.problem_text}")
    print(f"输出文件：{project.final_video_path}")


if __name__ == "__main__":
    # 运行示例
    example_1_simple()
