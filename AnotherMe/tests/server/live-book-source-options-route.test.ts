import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getUserMock, listClassroomBooksMock, initRAGStoreMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  listClassroomBooksMock: vi.fn(),
  initRAGStoreMock: vi.fn(),
}));

vi.mock('@/lib/auth/session', () => ({
  getAuthenticatedUserFromRequest: getUserMock,
}));

vi.mock('@/lib/server/classroom-book-service', () => ({
  listClassroomBooks: listClassroomBooksMock,
}));

vi.mock('@/lib/rag/vectorStore', () => ({
  initRAGStore: initRAGStoreMock,
}));

describe('live-book source-options route', () => {
  beforeEach(() => {
    getUserMock.mockReset();
    listClassroomBooksMock.mockReset();
    initRAGStoreMock.mockReset();
    getUserMock.mockResolvedValue({ id: 'user_1' });
  });

  it('returns generated ClassroomBook blocks as selectable note snapshots', async () => {
    listClassroomBooksMock.mockImplementation(async (userId: string) => (
      userId === 'user_1'
        ? [
            {
              id: 'book_1',
              title: '二次函数课堂',
              userId: 'user_1',
              blocks: [
                {
                  id: 'block_1',
                  type: 'explanation',
                  title: '顶点式',
                  content: '顶点式 y=a(x-h)^2+k 可以直接读出顶点坐标。',
                  knowledgePointIds: ['kp_vertex'],
                  sourceAnchorIds: ['anchor_1'],
                },
              ],
              sourceAnchors: [
                {
                  id: 'anchor_1',
                  sourceType: 'generated',
                  sourceId: 'job_1',
                  sourceName: 'Classroom Generator',
                  contentSnippet: '顶点式',
                  capturedAt: '2026-05-01T00:00:00.000Z',
                },
              ],
              meta: {
                sourceCapability: 'course_generate',
                originalTopic: '二次函数',
              },
              updatedAt: '2026-05-01T00:00:00.000Z',
            },
          ]
        : []
    ));

    const { GET } = await import('@/app/api/live-book/source-options/route');
    const response = await GET(new NextRequest('http://localhost/api/live-book/source-options?kind=notes'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.notes).toHaveLength(1);
    expect(json.notes[0]).toMatchObject({
      id: 'book_1:block_1',
      title: '二次函数课堂 / 顶点式',
      content: expect.stringContaining('顶点式'),
      bookId: 'book_1',
      source: 'classroom-book',
    });
    expect(json.notes[0].metadata.sourceAnchors[0].sourceName).toBe('Classroom Generator');
  });

  it('returns indexed RAG source summaries for kb options', async () => {
    initRAGStoreMock.mockResolvedValue({
      listSources: () => [
        {
          id: 'kb_math',
          title: '数学知识库',
          source: 'kb_math',
          kbId: 'kb_math',
          chunkCount: 8,
        },
      ],
    });

    const { GET } = await import('@/app/api/live-book/source-options/route');
    const response = await GET(new NextRequest('http://localhost/api/live-book/source-options?kind=kb'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.sources).toEqual([
      expect.objectContaining({ id: 'kb_math', title: '数学知识库', chunkCount: 8 }),
    ]);
  });
});
