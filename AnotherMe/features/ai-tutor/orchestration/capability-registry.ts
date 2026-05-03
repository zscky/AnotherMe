/**
 * Capability Registry - Capability/Tool separation inspired by DeepTutor.
 * 
 * DeepTutor separates Capability (what the system can do for learning) from
 * Tool (how the system does it). This provides a clean architecture:
 * 
 * Capabilities (learning-focused):
 * - course_generate, problem_video_generate, quiz_practice
 * - interactive_demo, ai_tutor_chat
 * 
 * Tools (infrastructure-focused):
 * - web_search, vision_parse, tts, manim_render
 * - student_profile, notebook
 * 
 * This separation allows:
 * 1. Capabilities to compose multiple tools
 * 2. Tools to be shared across capabilities
 * 3. Clear dependency tracking
 * 4. Feature flagging at capability level
 */

export type CapabilityId =
  | 'course_generate'
  | 'problem_video_generate'
  | 'quiz_practice'
  | 'interactive_demo'
  | 'ai_tutor_chat'
  | 'deep_solve'
  | 'deep_research'
  | 'math_animator'
  | 'visualize'
  | 'co_writer';

export type ToolId =
  | 'brainstorm'
  | 'rag'
  | 'web_search'
  | 'code_execution'
  | 'reason'
  | 'paper_search'
  | 'vision_parse'
  | 'tts'
  | 'manim_render'
  | 'student_profile'
  | 'notebook'
  | 'image_generation'
  | 'video_generation'
  | 'asr'
  | 'latex_render'
  | 'mermaid_render'
  | 'chart_render';

export type CapabilityStatus = 'available' | 'degraded' | 'unavailable';

export interface Capability {
  /** Unique capability identifier */
  id: CapabilityId;
  /** Display name */
  name: string;
  /** Description of what this capability does */
  description: string;
  /** Current status */
  status: CapabilityStatus;
  /** Tools this capability depends on */
  requiredTools: ToolId[];
  /** Optional tools this capability can use */
  optionalTools: ToolId[];
  /** Whether this capability is enabled */
  enabled: boolean;
  /** Capability configuration */
  config: Record<string, unknown>;
  /** Icon for UI display */
  icon: string;
  /** Category for grouping */
  category: 'generation' | 'practice' | 'chat' | 'visualization' | 'creation';
}

export interface Tool {
  /** Unique tool identifier */
  id: ToolId;
  /** Display name */
  name: string;
  /** Description of what this tool does */
  description: string;
  /** Whether this tool is available */
  available: boolean;
  /** Tool configuration */
  config: Record<string, unknown>;
  /** Provider information */
  provider: string | null;
  /** Last health check timestamp */
  lastHealthCheck: number | null;
  /** Error message if unavailable */
  errorMessage: string | null;
}

export interface CapabilityRegistry {
  /** All registered capabilities */
  capabilities: Map<CapabilityId, Capability>;
  /** All registered tools */
  tools: Map<ToolId, Tool>;
}

/**
 * Default capability definitions.
 */
export const DEFAULT_CAPABILITIES: Omit<Capability, 'status' | 'config'>[] = [
  {
    id: 'course_generate',
    name: '课程生成',
    description: '根据学习主题自动生成结构化课程',
    requiredTools: ['web_search'],
    optionalTools: ['image_generation', 'video_generation', 'tts'],
    enabled: true,
    icon: 'BookOpen',
    category: 'generation',
  },
  {
    id: 'problem_video_generate',
    name: '题目视频生成',
    description: '上传题目图片生成讲解视频',
    requiredTools: ['vision_parse', 'manim_render', 'tts'],
    optionalTools: ['student_profile'],
    enabled: true,
    icon: 'Video',
    category: 'generation',
  },
  {
    id: 'quiz_practice',
    name: '测验练习',
    description: '生成并评分测验题目',
    requiredTools: ['rag', 'web_search', 'code_execution'],
    optionalTools: ['student_profile'],
    enabled: true,
    icon: 'CircleHelp',
    category: 'practice',
  },
  {
    id: 'interactive_demo',
    name: '互动演示',
    description: '生成可交互的科学模拟',
    requiredTools: [],
    optionalTools: [],
    enabled: true,
    icon: 'MousePointer2',
    category: 'practice',
  },
  {
    id: 'ai_tutor_chat',
    name: 'AI导师对话',
    description: '与AI导师进行个性化对话学习',
    requiredTools: [],
    optionalTools: ['student_profile', 'notebook', 'web_search'],
    enabled: true,
    icon: 'MessageSquare',
    category: 'chat',
  },
  {
    id: 'deep_solve',
    name: '深度解题',
    description: '多智能体协作深度解题',
    requiredTools: ['rag', 'web_search', 'code_execution', 'reason'],
    optionalTools: ['student_profile', 'notebook'],
    enabled: true,
    icon: 'Brain',
    category: 'chat',
  },
  {
    id: 'deep_research',
    name: '深度研究',
    description: '多轮搜索与深度分析',
    requiredTools: ['rag', 'web_search', 'paper_search', 'code_execution'],
    optionalTools: ['notebook'],
    enabled: true,
    icon: 'Search',
    category: 'generation',
  },
  {
    id: 'math_animator',
    name: '数学动画',
    description: '生成数学概念动画讲解',
    requiredTools: [],
    optionalTools: [],
    enabled: true,
    icon: 'Play',
    category: 'visualization',
  },
  {
    id: 'visualize',
    name: '可视化',
    description: '生成图表和可视化内容',
    requiredTools: [],
    optionalTools: [],
    enabled: true,
    icon: 'BarChart3',
    category: 'visualization',
  },
  {
    id: 'co_writer',
    name: 'AI协作者',
    description: '多文档Markdown协作工作区',
    requiredTools: [],
    optionalTools: ['notebook'],
    enabled: true,
    icon: 'PenTool',
    category: 'creation',
  },
];

/**
 * Default tool definitions.
 */
export const DEFAULT_TOOLS: Omit<Tool, 'available' | 'lastHealthCheck' | 'errorMessage'>[] = [
  {
    id: 'brainstorm',
    name: '头脑风暴',
    description: '辅助发散思考并生成解题或学习思路',
    config: {},
    provider: null,
  },
  {
    id: 'rag',
    name: '知识库检索',
    description: '检索课堂笔记、课程内容和用户知识库',
    config: {},
    provider: null,
  },
  {
    id: 'web_search',
    name: '联网搜索',
    description: '使用搜索引擎获取最新信息',
    config: {},
    provider: null,
  },
  {
    id: 'code_execution',
    name: '代码执行',
    description: '运行受限 Python 代码进行计算、校验或数据分析',
    config: {},
    provider: null,
  },
  {
    id: 'reason',
    name: '深度推理',
    description: '执行多步骤推理并梳理推导过程',
    config: {},
    provider: null,
  },
  {
    id: 'paper_search',
    name: '论文检索',
    description: '检索 arXiv 等学术论文资料',
    config: {},
    provider: null,
  },
  {
    id: 'vision_parse',
    name: '视觉解析',
    description: '使用视觉模型理解图片内容',
    config: {},
    provider: null,
  },
  {
    id: 'tts',
    name: '语音合成',
    description: '将文本转换为语音',
    config: {},
    provider: null,
  },
  {
    id: 'manim_render',
    name: 'Manim渲染',
    description: '使用Manim生成数学动画',
    config: {},
    provider: null,
  },
  {
    id: 'student_profile',
    name: '学生画像',
    description: '获取学生的学习画像和能力评估',
    config: {},
    provider: null,
  },
  {
    id: 'notebook',
    name: '笔记本',
    description: '保存和管理学习笔记',
    config: {},
    provider: null,
  },
  {
    id: 'image_generation',
    name: '图像生成',
    description: '使用AI生成教学配图',
    config: {},
    provider: null,
  },
  {
    id: 'video_generation',
    name: '视频生成',
    description: '使用AI生成教学视频',
    config: {},
    provider: null,
  },
  {
    id: 'asr',
    name: '语音识别',
    description: '将语音转换为文本',
    config: {},
    provider: null,
  },
  {
    id: 'latex_render',
    name: 'LaTeX渲染',
    description: '渲染数学公式',
    config: {},
    provider: null,
  },
  {
    id: 'mermaid_render',
    name: 'Mermaid渲染',
    description: '渲染Mermaid图表',
    config: {},
    provider: null,
  },
  {
    id: 'chart_render',
    name: '图表渲染',
    description: '使用Chart.js生成图表',
    config: {},
    provider: null,
  },
];

/**
 * Creates a new capability registry with default capabilities and tools.
 */
export function createCapabilityRegistry(): CapabilityRegistry {
  const capabilities = new Map<CapabilityId, Capability>();
  const tools = new Map<ToolId, Tool>();
  
  for (const cap of DEFAULT_CAPABILITIES) {
    capabilities.set(cap.id, {
      ...cap,
      status: 'available',
      config: {},
    });
  }
  
  for (const tool of DEFAULT_TOOLS) {
    tools.set(tool.id, {
      ...tool,
      available: true,
      lastHealthCheck: null,
      errorMessage: null,
    });
  }
  
  return { capabilities, tools };
}

/**
 * Checks if a capability is available (all required tools are available).
 */
export function isCapabilityAvailable(
  registry: CapabilityRegistry,
  capabilityId: CapabilityId,
): boolean {
  const capability = registry.capabilities.get(capabilityId);
  if (!capability || !capability.enabled) return false;
  
  return capability.requiredTools.every((toolId) => {
    const tool = registry.tools.get(toolId);
    return tool?.available ?? false;
  });
}

/**
 * Gets the availability status of all capabilities.
 */
export function getCapabilityAvailability(
  registry: CapabilityRegistry,
): Record<CapabilityId, boolean> {
  const result = {} as Record<CapabilityId, boolean>;
  
  for (const capId of registry.capabilities.keys()) {
    result[capId] = isCapabilityAvailable(registry, capId);
  }
  
  return result;
}

/**
 * Updates tool availability status.
 */
export function updateToolAvailability(
  registry: CapabilityRegistry,
  toolId: ToolId,
  available: boolean,
  errorMessage: string | null = null,
): void {
  const tool = registry.tools.get(toolId);
  if (tool) {
    tool.available = available;
    tool.lastHealthCheck = Date.now();
    tool.errorMessage = errorMessage;
  }
}

/**
 * Gets capabilities that depend on a specific tool.
 */
export function getCapabilitiesUsingTool(
  registry: CapabilityRegistry,
  toolId: ToolId,
): Capability[] {
  const result: Capability[] = [];
  
  for (const capability of registry.capabilities.values()) {
    if (
      capability.requiredTools.includes(toolId) ||
      capability.optionalTools.includes(toolId)
    ) {
      result.push(capability);
    }
  }
  
  return result;
}

/**
 * Gets the effective capability list for a user session.
 * Only returns enabled and available capabilities.
 */
export function getEffectiveCapabilities(
  registry: CapabilityRegistry,
): Capability[] {
  const result: Capability[] = [];
  
  for (const capability of registry.capabilities.values()) {
    if (capability.enabled && isCapabilityAvailable(registry, capability.id)) {
      result.push(capability);
    }
  }
  
  return result;
}
