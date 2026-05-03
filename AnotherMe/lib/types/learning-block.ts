/**
 * LearningBlock - Upgrade from Scene-level to Block-level learning objects.
 * 
 * Inspired by DeepTutor's Book Engine block system. While SceneType already has
 * slide | quiz | interactive | pbl, the granularity is still "scene-level" and lacks:
 * - Block-level source tracking
 * - Learning objectives
 * - Attempt tracking
 * - Misconception tags
 * - Retry/failure state
 * 
 * This extends SceneContent with LearningBlock metadata for better traceability,
 * review recommendations, and failure retry capabilities.
 */

import type { Scene, SceneContent, QuizQuestion } from '@/lib/types/stage';
import type { Slide } from '@/lib/types/slides';
import type { PBLProjectConfig } from '@/lib/pbl/types';

export type BlockType = 'slide' | 'quiz' | 'interactive' | 'pbl' | 'video' | 'reading' | 'practice' | 'review';

export type BlockStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped' | 'retrying';

export type BlockDifficulty = 'easy' | 'medium' | 'hard' | 'adaptive';

export interface SourceAnchor {
  /** Source type: 'generated', 'uploaded', 'external_url', 'textbook_reference' */
  type: 'generated' | 'uploaded' | 'external_url' | 'textbook_reference';
  /** Source identifier (URL, file path, textbook page, etc.) */
  identifier: string;
  /** Optional description of the source */
  description?: string;
}

export interface AttemptRecord {
  /** Attempt ID */
  id: string;
  /** Timestamp of the attempt */
  timestamp: number;
  /** Whether the attempt was successful */
  success: boolean | null;
  /** Score if applicable (0-100) */
  score?: number;
  /** Time spent in milliseconds */
  timeSpentMs?: number;
  /** Hints used during this attempt */
  hintsUsed: string[];
  /** Knowledge points the student struggled with */
  struggledPoints: string[];
}

export interface LearningBlockMetadata {
  /** Block type */
  type: BlockType;
  /** Current status of this block */
  status: BlockStatus;
  /** Difficulty level */
  difficulty: BlockDifficulty;
  /** Learning objectives for this block */
  learningObjectives: string[];
  /** Knowledge points covered */
  knowledgePoints: string[];
  /** Misconception tags identified from student behavior */
  misconceptionTags: string[];
  /** Source anchors (where this block's content came from) */
  sourceAnchors: SourceAnchor[];
  /** Attempt history */
  attempts: AttemptRecord[];
  /** Which agent/system generated this block */
  generatedBy: string;
  /** Estimated time to complete in minutes */
  estimatedTimeMinutes: number;
  /** Prerequisite block IDs */
  prerequisiteBlockIds: string[];
  /** Related block IDs (for review/recommendation) */
  relatedBlockIds: string[];
  /** Whether this block is recommended for review */
  recommendedForReview: boolean;
  /** Review recommendation reason */
  reviewReason?: string;
}

/**
 * LearningBlock extends Scene with block-level metadata.
 * Every Scene can have one or more LearningBlocks.
 */
export interface LearningBlock {
  /** Unique block ID */
  id: string;
  /** Parent scene ID */
  sceneId: string;
  /** Parent stage/classroom ID */
  stageId: string;
  /** Block order within the scene */
  order: number;
  /** Block title */
  title: string;
  /** Block metadata */
  metadata: LearningBlockMetadata;
  /** Block content (references the original scene content) */
  content: BlockContent;
  /** Created timestamp */
  createdAt: number;
  /** Updated timestamp */
  updatedAt: number;
}

export type BlockContent =
  | SlideBlockContent
  | QuizBlockContent
  | InteractiveBlockContent
  | PBLBlockContent
  | VideoBlockContent
  | ReadingBlockContent
  | PracticeBlockContent
  | ReviewBlockContent;

export interface SlideBlockContent {
  type: 'slide';
  canvas: Slide;
}

export interface QuizBlockContent {
  type: 'quiz';
  questions: QuizQuestion[];
  passingScore?: number;
  maxAttempts?: number;
}

export interface InteractiveBlockContent {
  type: 'interactive';
  url: string;
  html?: string;
}

export interface PBLBlockContent {
  type: 'pbl';
  projectConfig: PBLProjectConfig;
}

export interface VideoBlockContent {
  type: 'video';
  videoUrl: string;
  transcript?: string;
  durationSeconds?: number;
}

export interface ReadingBlockContent {
  type: 'reading';
  markdownContent: string;
  readingTimeMinutes: number;
}

export interface PracticeBlockContent {
  type: 'practice';
  problemSet: string[];
  solutionHints: string[];
}

export interface ReviewBlockContent {
  type: 'review';
  reviewItems: ReviewItem[];
}

export interface ReviewItem {
  id: string;
  type: 'knowledge_point' | 'misconception' | 'problem';
  content: string;
  masteryScore: number;
  lastReviewedAt?: number;
}

/**
 * Converts a Scene to a LearningBlock.
 */
export function sceneToLearningBlock(scene: Scene, overrides?: Partial<LearningBlock>): LearningBlock {
  const blockContent = sceneContentToBlockContent(scene.content);
  
  return {
    id: `block-${scene.id}`,
    sceneId: scene.id,
    stageId: scene.stageId,
    order: scene.order,
    title: scene.title,
    metadata: {
      type: scene.type as BlockType,
      status: 'pending',
      difficulty: 'adaptive',
      learningObjectives: [],
      knowledgePoints: [],
      misconceptionTags: [],
      sourceAnchors: [],
      attempts: [],
      generatedBy: 'system',
      estimatedTimeMinutes: estimateBlockTime(blockContent.type),
      prerequisiteBlockIds: [],
      relatedBlockIds: [],
      recommendedForReview: false,
    },
    content: blockContent,
    createdAt: scene.createdAt ?? Date.now(),
    updatedAt: scene.updatedAt ?? Date.now(),
    ...overrides,
  };
}

function sceneContentToBlockContent(content: SceneContent): BlockContent {
  switch (content.type) {
    case 'slide':
      return { type: 'slide', canvas: content.canvas };
    case 'quiz':
      return { type: 'quiz', questions: content.questions };
    case 'interactive':
      return { type: 'interactive', url: content.url, html: content.html };
    case 'pbl':
      return { type: 'pbl', projectConfig: content.projectConfig };
    default:
      return { type: 'reading', markdownContent: '', readingTimeMinutes: 5 };
  }
}

function estimateBlockTime(type: BlockType): number {
  const estimates: Record<BlockType, number> = {
    slide: 8,
    quiz: 6,
    interactive: 10,
    pbl: 12,
    video: 5,
    reading: 5,
    practice: 8,
    review: 10,
  };
  return estimates[type] ?? 8;
}

/**
 * Records an attempt on a learning block.
 */
export function recordBlockAttempt(
  block: LearningBlock,
  attempt: Omit<AttemptRecord, 'id' | 'timestamp'>,
): LearningBlock {
  const newAttempt: AttemptRecord = {
    ...attempt,
    id: `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  
  const newStatus: BlockStatus = attempt.success === true
    ? 'completed'
    : attempt.success === false
      ? 'failed'
      : block.metadata.status;
  
  return {
    ...block,
    metadata: {
      ...block.metadata,
      status: newStatus,
      attempts: [...block.metadata.attempts, newAttempt],
    },
    updatedAt: Date.now(),
  };
}

/**
 * Adds a misconception tag to a block.
 */
export function addMisconceptionTag(
  block: LearningBlock,
  tag: string,
): LearningBlock {
  if (block.metadata.misconceptionTags.includes(tag)) {
    return block;
  }
  
  return {
    ...block,
    metadata: {
      ...block.metadata,
      misconceptionTags: [...block.metadata.misconceptionTags, tag],
    },
    updatedAt: Date.now(),
  };
}

/**
 * Marks a block for review based on performance.
 */
export function markForReview(
  block: LearningBlock,
  reason: string,
): LearningBlock {
  return {
    ...block,
    metadata: {
      ...block.metadata,
      recommendedForReview: true,
      reviewReason: reason,
    },
    updatedAt: Date.now(),
  };
}

/**
 * Gets blocks recommended for review from a list.
 */
export function getReviewRecommendedBlocks(blocks: LearningBlock[]): LearningBlock[] {
  return blocks.filter((b) => b.metadata.recommendedForReview);
}

/**
 * Calculates block mastery score from attempts.
 */
export function calculateBlockMastery(block: LearningBlock): number {
  const attempts = block.metadata.attempts;
  if (attempts.length === 0) return 0;
  
  const successfulAttempts = attempts.filter((a) => a.success === true);
  const totalAttempts = attempts.length;
  
  const successRate = successfulAttempts.length / totalAttempts;
  const recencyBonus = attempts.length > 1 ? 0.1 : 0;
  
  return Math.min(1, successRate * 0.8 + recencyBonus);
}
