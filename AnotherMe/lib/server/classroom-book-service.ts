/**
 * ClassroomBook Service - Lightweight persistent storage for learning artifacts.
 *
 * Provides save/load/list for ClassroomBook instances. Currently uses the
 * local filesystem under .workbuddy/classroom-books/ as the backing store.
 * This can be swapped for a database backend (PostgreSQL, MongoDB) later
 * without changing the interface.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { ClassroomBook, LearningBlock, SourceAnchor } from '@/lib/types/classroom-book';
import { createEmptyBook, addBlock, addSourceAnchor } from '@/lib/types/classroom-book';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomBookService');

const STORAGE_DIR = path.join(process.cwd(), '.workbuddy', 'classroom-books');

async function ensureStorageDir(): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    log.error('Failed to create classroom-book storage directory:', error);
    throw error;
  }
}

function bookFilePath(userId: string, bookId: string): string {
  const userDir = path.join(STORAGE_DIR, userId);
  return path.join(userDir, `${bookId}.json`);
}

async function ensureUserDir(userId: string): Promise<void> {
  const userDir = path.join(STORAGE_DIR, userId);
  await fs.mkdir(userDir, { recursive: true });
}

/**
 * Save a ClassroomBook to persistent storage.
 */
export async function saveClassroomBook(book: ClassroomBook): Promise<void> {
  await ensureUserDir(book.userId);
  const filePath = bookFilePath(book.userId, book.id);
  try {
    await fs.writeFile(filePath, JSON.stringify(book, null, 2), 'utf-8');
    log.info(`Saved ClassroomBook ${book.id} for user ${book.userId}`);
  } catch (error) {
    log.error(`Failed to save ClassroomBook ${book.id}:`, error);
    throw error;
  }
}

/**
 * Load a ClassroomBook by userId and bookId.
 */
export async function loadClassroomBook(
  userId: string,
  bookId: string,
): Promise<ClassroomBook | null> {
  const filePath = bookFilePath(userId, bookId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as ClassroomBook;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    log.error(`Failed to load ClassroomBook ${bookId}:`, error);
    throw error;
  }
}

/**
 * List all ClassroomBooks for a user.
 */
export async function listClassroomBooks(userId: string): Promise<ClassroomBook[]> {
  const userDir = path.join(STORAGE_DIR, userId);
  try {
    const entries = await fs.readdir(userDir);
    const books: ClassroomBook[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const bookId = entry.slice(0, -5);
      const book = await loadClassroomBook(userId, bookId);
      if (book) books.push(book);
    }
    return books;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    log.error(`Failed to list ClassroomBooks for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Delete a ClassroomBook.
 */
export async function deleteClassroomBook(userId: string, bookId: string): Promise<void> {
  const filePath = bookFilePath(userId, bookId);
  try {
    await fs.unlink(filePath);
    log.info(`Deleted ClassroomBook ${bookId} for user ${userId}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error(`Failed to delete ClassroomBook ${bookId}:`, error);
      throw error;
    }
  }
}

// ----------------------- Problem Video artifact builder -----------------------

export interface ProblemVideoArtifactInput {
  userId: string;
  jobId: string;
  problemText?: string;
  imageObjectKey: string;
  sourceCapability?: string;
  knowledgePointIds?: string[];
}

export function buildProblemVideoClassroomBook(input: ProblemVideoArtifactInput): ClassroomBook {
  const now = new Date().toISOString();
  const book = createEmptyBook({
    id: `pv-book-${input.jobId}-${Date.now()}`,
    title: input.problemText ? `拍题视频: ${input.problemText.slice(0, 30)}` : `拍题视频 ${now.slice(0, 10)}`,
    userId: input.userId,
    originalTopic: input.problemText || 'problem_video',
    sourceCapability: input.sourceCapability || 'problem_video_generate',
  });

  const videoAnchor: Omit<SourceAnchor, 'id' | 'capturedAt'> = {
    sourceType: 'generated',
    sourceId: input.jobId,
    sourceName: 'Problem Video Generator',
    location: `job:${input.jobId}`,
    contentSnippet: input.problemText?.slice(0, 200) || `Image: ${input.imageObjectKey}`,
  };

  let updated = addSourceAnchor(book, videoAnchor);

  const explanationBlock: Omit<LearningBlock, 'id'> = {
    type: 'explanation',
    title: '题目讲解视频',
    content: input.problemText || '拍题生成的讲解视频',
    knowledgePointIds: input.knowledgePointIds || [],
    sourceAnchorIds: [updated.sourceAnchors[updated.sourceAnchors.length - 1].id],
    completed: false,
    orderIndex: 0,
  };

  updated = addBlock(updated, explanationBlock);

  return updated;
}

// ----------------------- Classroom Generation artifact builder -----------------------

export interface ClassroomGenerationArtifactInput {
  userId: string;
  jobId: string;
  requirement: string;
  sourceCapability?: string;
  knowledgePointIds?: string[];
  classroomId?: string;
  url?: string;
}

export function buildClassroomGenerationClassroomBook(input: ClassroomGenerationArtifactInput): ClassroomBook {
  const now = new Date().toISOString();
  const book = createEmptyBook({
    id: `cg-book-${input.jobId}-${Date.now()}`,
    title: input.requirement.length > 40 ? `${input.requirement.slice(0, 37)}...` : input.requirement,
    userId: input.userId,
    originalTopic: input.requirement,
    sourceCapability: input.sourceCapability || 'course_generate',
  });

  const classAnchor: Omit<SourceAnchor, 'id' | 'capturedAt'> = {
    sourceType: 'generated',
    sourceId: input.jobId,
    sourceName: 'Classroom Generator',
    location: `job:${input.jobId}${input.classroomId ? `,classroom:${input.classroomId}` : ''}`,
    contentSnippet: input.requirement.slice(0, 200),
    url: input.url || undefined,
  };

  let updated = addSourceAnchor(book, classAnchor);

  const courseBlock: Omit<LearningBlock, 'id'> = {
    type: 'summary',
    title: '课程概览',
    content: input.requirement,
    knowledgePointIds: input.knowledgePointIds || [],
    sourceAnchorIds: [updated.sourceAnchors[updated.sourceAnchors.length - 1].id],
    completed: false,
    orderIndex: 0,
  };

  updated = addBlock(updated, courseBlock);

  return updated;
}

// ----------------------- Chat artifact builders -----------------------

export interface ChatArtifactInput {
  userId: string;
  sessionId: string;
  requestId: string;
  assistantText: string;
  topic?: string | null;
  sourceCapability?: string;
  knowledgePointIds?: string[];
}

/**
 * Build a minimal ClassroomBook from a single chat turn.
 *
 * This is a starting point — over time the book accumulates blocks from
 * multiple turns and can be merged into a larger course-level book.
 */
export function buildChatClassroomBook(input: ChatArtifactInput): ClassroomBook {
  const now = new Date().toISOString();
  const book = createEmptyBook({
    id: `chat-book-${input.sessionId}-${Date.now()}`,
    title: input.topic || `对话产物 ${now.slice(0, 10)}`,
    userId: input.userId,
    originalTopic: input.topic || 'chat',
    sourceCapability: input.sourceCapability || 'ai_tutor_chat',
  });

  // Source anchor: this chat turn
  const chatAnchor: Omit<SourceAnchor, 'id' | 'capturedAt'> = {
    sourceType: 'generated',
    sourceId: input.requestId,
    sourceName: 'AI Tutor Chat',
    location: `session:${input.sessionId}`,
    contentSnippet: input.assistantText.slice(0, 200),
  };

  let updated = addSourceAnchor(book, chatAnchor);

  // Main explanation block from assistant response
  const explanationBlock: Omit<LearningBlock, 'id'> = {
    type: 'explanation',
    title: 'AI 讲解',
    content: input.assistantText,
    knowledgePointIds: input.knowledgePointIds || [],
    sourceAnchorIds: [updated.sourceAnchors[updated.sourceAnchors.length - 1].id],
    completed: false,
    orderIndex: 0,
  };

  updated = addBlock(updated, explanationBlock);

  return updated;
}

/**
 * Append a new block to an existing ClassroomBook and save it.
 */
export async function appendBlockToBook(
  userId: string,
  bookId: string,
  block: Omit<LearningBlock, 'id'>,
): Promise<ClassroomBook | null> {
  const book = await loadClassroomBook(userId, bookId);
  if (!book) return null;

  const updated = addBlock(book, { ...block, orderIndex: book.blocks.length });
  await saveClassroomBook(updated);
  return updated;
}
