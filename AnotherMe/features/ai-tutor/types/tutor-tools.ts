/**
 * AI导师工具类型定义
 * 定义六个可勾选的工具：brainstorm、rag、web_search、code_execution、reason、paper_search
 */

export type TutorToolName =
  | 'brainstorm'
  | 'rag'
  | 'web_search'
  | 'code_execution'
  | 'reason'
  | 'paper_search';

/**
 * RAG 数据源
 */
export interface RAGDataSource {
  /** 笔记列表 */
  notes?: Array<{
    id: string;
    title: string;
    content: string;
    tags: string[];
    subject: string;
    source: string;
    createdAt: number;
  }>;
  /** ClassroomBook 列表 */
  classroomBooks?: Array<{
    id: string;
    title: string;
    blocks: Array<{
      title: string;
      content: string;
      type: string;
    }>;
  }>;
  /** 当前舞台信息 */
  currentStage?: {
    title?: string;
    description?: string;
    scenes?: Array<{
      title?: string;
      content?: string;
    }>;
  };
}

export interface TutorToolConfig {
  /** 知识库ID（用于RAG） */
  knowledgeBase?: string;
  /** RAG 数据源（JSON序列化后传递） */
  ragDataSource?: RAGDataSource;
  /** 用户ID（用于服务端获取 ClassroomBook） */
  userId?: string;
  /** RAG 最大结果数 */
  maxRAGResults?: number;
  /** 是否启用 LlamaIndex 向量检索（依赖可选） */
  useLlamaIndex?: boolean;
  /** 论文搜索最大结果数 */
  maxPaperResults?: number;
  /** 联网搜索最大结果数 */
  maxWebResults?: number;
  /** Tavily API Key（可选，优先于服务端配置） */
  tavilyApiKey?: string;
  /** 代码执行超时时间（秒） */
  codeTimeoutSec?: number;
}

export interface TutorToolState {
  /** 已启用的工具列表 */
  enabledTools: TutorToolName[];
  /** 工具配置 */
  config: TutorToolConfig;
  /**
   * P2: 是否使用 Agentic Pipeline 模式
   * - true: 使用 thinking -> acting -> observing -> responding 四阶段，模型按需选择工具
   * - false: 预执行所有启用的工具（legacy 模式）
   * @default false (保持向后兼容)
   */
  useAgenticPipeline?: boolean;
}

export interface TutorToolDefinition {
  id: TutorToolName;
  label: string;
  description: string;
  icon: string;
}

export const TUTOR_TOOLS: TutorToolDefinition[] = [
  {
    id: 'brainstorm',
    label: '头脑风暴',
    description: 'AI辅助发散思考，生成创意点子',
    icon: 'Lightbulb',
  },
  {
    id: 'rag',
    label: '知识库',
    description: '检索课堂笔记和学习资料',
    icon: 'BookOpen',
  },
  {
    id: 'web_search',
    label: '联网搜索',
    description: '搜索互联网获取最新信息',
    icon: 'Globe',
  },
  {
    id: 'code_execution',
    label: '代码执行',
    description: '运行Python代码进行计算或验证',
    icon: 'Code',
  },
  {
    id: 'reason',
    label: '深度推理',
    description: 'AI进行多步骤深度分析',
    icon: 'Brain',
  },
  {
    id: 'paper_search',
    label: '论文检索',
    description: '搜索arXiv学术论文',
    icon: 'FileText',
  },
];
