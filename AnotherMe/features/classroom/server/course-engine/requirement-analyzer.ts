import { nanoid } from 'nanoid';
import type {
  DifficultyLevel,
  GradeBand,
  KnowledgeNode,
  MisconceptionTag,
  PedagogyProfile,
  PedagogyProfileInput,
  QuestionType,
  RequirementAnalysis,
} from './types';

const GRADE_TOPIC_KEYWORDS: Record<
  Exclude<GradeBand, 'auto'>,
  Array<{ keyword: string; node: Omit<KnowledgeNode, 'id'> }>
> = {
  grade7: [
    {
      keyword: '有理数',
      node: {
        label: '有理数运算',
        module: 'number',
        difficulty: 'easy',
        prerequisites: [],
      },
    },
    {
      keyword: '一元一次方程',
      node: {
        label: '一元一次方程',
        module: 'algebra',
        difficulty: 'easy',
        prerequisites: ['有理数运算'],
      },
    },
    {
      keyword: '整式',
      node: {
        label: '整式加减',
        module: 'algebra',
        difficulty: 'medium',
        prerequisites: ['有理数运算'],
      },
    },
  ],
  grade8: [
    {
      keyword: '一次函数',
      node: {
        label: '一次函数与图像',
        module: 'function',
        difficulty: 'medium',
        prerequisites: ['一元一次方程'],
      },
    },
    {
      keyword: '全等三角形',
      node: {
        label: '全等三角形判定',
        module: 'geometry',
        difficulty: 'medium',
        prerequisites: ['三角形性质'],
      },
    },
    {
      keyword: '勾股',
      node: {
        label: '勾股定理应用',
        module: 'geometry',
        difficulty: 'medium',
        prerequisites: ['直角三角形'],
      },
    },
  ],
  grade9: [
    {
      keyword: '二次函数',
      node: {
        label: '二次函数性质',
        module: 'function',
        difficulty: 'hard',
        prerequisites: ['一次函数与图像'],
      },
    },
    {
      keyword: '圆',
      node: {
        label: '圆与角度关系',
        module: 'geometry',
        difficulty: 'hard',
        prerequisites: ['全等三角形判定'],
      },
    },
    {
      keyword: '相似三角形',
      node: {
        label: '相似三角形性质',
        module: 'geometry',
        difficulty: 'hard',
        prerequisites: ['全等三角形判定'],
      },
    },
  ],
};

const MATH_KEYWORDS = [
  '数学',
  '方程',
  '函数',
  '三角形',
  '几何',
  '代数',
  '概率',
  '圆',
  '中考',
];

function inferGradeBand(requirement: string): Exclude<GradeBand, 'auto'> {
  if (/初一|七年级|grade ?7/i.test(requirement)) return 'grade7';
  if (/初二|八年级|grade ?8/i.test(requirement)) return 'grade8';
  if (/初三|九年级|grade ?9|中考/i.test(requirement)) return 'grade9';
  if (/二次函数|圆|相似三角形/.test(requirement)) return 'grade9';
  if (/一次函数|全等三角形|勾股/.test(requirement)) return 'grade8';
  return 'grade8';
}

function inferQuestionTypes(requirement: string): QuestionType[] {
  const lowered = requirement.toLowerCase();
  const result = new Set<QuestionType>(['single', 'text']);

  if (/多选|multiple/.test(lowered)) result.add('multiple');
  if (/选择|单选|choice/.test(lowered)) result.add('single');
  if (/证明|推导|过程|steps|derive/.test(lowered)) result.add('text');
  if (/应用|综合|中考/.test(requirement)) result.add('multiple');

  return Array.from(result);
}

function inferMisconceptions(requirement: string): MisconceptionTag[] {
  const tags = new Set<MisconceptionTag>(['formula_misuse', 'reasoning_jump']);
  if (/图|几何|圆|三角形/.test(requirement)) tags.add('diagram_misread');
  if (/证明|步骤|推理/.test(requirement)) tags.add('condition_omission');
  if (/符号|字母|函数/.test(requirement)) tags.add('symbol_confusion');
  return Array.from(tags);
}

function inferDifficultyCurve(strictness: 'standard' | 'high'): DifficultyLevel[] {
  return strictness === 'high'
    ? ['easy', 'medium', 'medium', 'hard', 'hard', 'hard']
    : ['easy', 'medium', 'medium', 'hard', 'medium', 'medium'];
}

function inferSkillTargets(requirement: string): string[] {
  const targets = ['概念辨析', '分步解题', '错因归纳'];
  if (/证明|推理/.test(requirement)) targets.push('逻辑推理');
  if (/中考|综合/.test(requirement)) targets.push('题型迁移');
  return Array.from(new Set(targets));
}

function collectKnowledgeNodes(
  requirement: string,
  gradeBand: Exclude<GradeBand, 'auto'>,
): KnowledgeNode[] {
  const selected: KnowledgeNode[] = [];
  const addFrom = (
    source: Array<{ keyword: string; node: Omit<KnowledgeNode, 'id'> }>,
    forceAll = false,
  ) => {
    source.forEach(({ keyword, node }) => {
      if (forceAll || requirement.includes(keyword)) {
        selected.push({
          ...node,
          id: `kn_${nanoid(6)}`,
        });
      }
    });
  };

  addFrom(GRADE_TOPIC_KEYWORDS[gradeBand]);
  if (selected.length === 0) {
    addFrom(GRADE_TOPIC_KEYWORDS[gradeBand], true);
    selected.splice(2);
  }
  return selected;
}

export function normalizePedagogyProfile(
  input?: PedagogyProfileInput,
  inferredGradeBand?: Exclude<GradeBand, 'auto'>,
): PedagogyProfile {
  const chosenGradeBand =
    input?.grade_band && input.grade_band !== 'auto'
      ? input.grade_band
      : (inferredGradeBand ?? 'grade8');

  return {
    domain: 'middle-school-math',
    examOrientation: 'zhongkao',
    gradeBand: chosenGradeBand,
    strictness: input?.strictness === 'high' ? 'high' : 'standard',
  };
}

export function analyzeMiddleSchoolMathRequirement(params: {
  requirement: string;
  language: 'zh-CN' | 'en-US';
  pedagogyProfile?: PedagogyProfileInput;
  pdfText?: string;
}): RequirementAnalysis {
  const requirement = params.requirement.trim();
  const trace: string[] = [];
  const inferredGradeBand = inferGradeBand(requirement);
  const profile = normalizePedagogyProfile(params.pedagogyProfile, inferredGradeBand);
  trace.push(`grade_band=${profile.gradeBand}`);
  trace.push(`strictness=${profile.strictness}`);

  const knowledgeNodes = collectKnowledgeNodes(requirement, profile.gradeBand);
  trace.push(`knowledge_nodes=${knowledgeNodes.map((item) => item.label).join(',')}`);

  const prerequisiteHints = Array.from(
    new Set(knowledgeNodes.flatMap((node) => node.prerequisites)),
  ).slice(0, 4);
  const difficultyCurve = inferDifficultyCurve(profile.strictness);
  const preferredQuestionTypes = inferQuestionTypes(requirement);
  const misconceptions = inferMisconceptions(requirement);
  const skillTargets = inferSkillTargets(requirement);

  const isMathClass = MATH_KEYWORDS.some((keyword) => requirement.includes(keyword));
  trace.push(`is_math=${isMathClass ? 'yes' : 'no'}`);
  if (params.pdfText?.trim()) {
    trace.push(`pdf_context=${Math.min(params.pdfText.length, 2000)}chars`);
  }

  return {
    topic: requirement.slice(0, 80),
    language: params.language,
    gradeBand: profile.gradeBand,
    profile,
    isMathClass,
    knowledgeNodes,
    misconceptions,
    skillTargets,
    preferredQuestionTypes,
    prerequisiteHints,
    difficultyCurve,
    analysisTrace: trace,
  };
}
