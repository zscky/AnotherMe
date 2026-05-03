import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { createLiveBookMock } = vi.hoisted(() => ({
  createLiveBookMock: vi.fn(),
}));

vi.mock('@/lib/server/live-book-store', () => ({
  createLiveBook: createLiveBookMock,
}));

describe('live-book create route', () => {
  beforeEach(() => {
    createLiveBookMock.mockReset();
    createLiveBookMock.mockResolvedValue({
      id: 'book_1',
      title: '测试活书',
      topic: '二次函数',
      status: 'draft',
    });
  });

  it('accepts sources that only contain snapshots', async () => {
    const { POST } = await import('@/app/api/live-book/create/route');

    const response = await POST(
      new NextRequest('http://localhost/api/live-book/create', {
        method: 'POST',
        body: JSON.stringify({
          topic: '二次函数',
          sources: [
            {
              kind: 'notes',
              text: '',
              notebookRefs: ['note_1'],
              snapshots: [
                {
                  kind: 'note',
                  id: 'note_1',
                  title: '顶点式',
                  content: '顶点式 y=a(x-h)^2+k。',
                },
              ],
            },
          ],
        }),
      }),
    );

    const json = await response.json();
    expect(response.status).toBe(201);
    expect(json.success).toBe(true);
    expect(createLiveBookMock).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: '二次函数',
        sources: [
          expect.objectContaining({
            kind: 'notes',
            notebookRefs: ['note_1'],
            snapshots: [
              expect.objectContaining({
                id: 'note_1',
                content: '顶点式 y=a(x-h)^2+k。',
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('drops empty source items before calling createLiveBook', async () => {
    const { POST } = await import('@/app/api/live-book/create/route');

    await POST(
      new NextRequest('http://localhost/api/live-book/create', {
        method: 'POST',
        body: JSON.stringify({
          topic: '二次函数',
          sources: [{ kind: 'notes', text: '', snapshots: [] }],
        }),
      }),
    );

    expect(createLiveBookMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: [],
      }),
    );
  });

  it('passes long snapshots to store normalization', async () => {
    const { POST } = await import('@/app/api/live-book/create/route');
    const longContent = 'x'.repeat(6000);

    await POST(
      new NextRequest('http://localhost/api/live-book/create', {
        method: 'POST',
        body: JSON.stringify({
          topic: '二次函数',
          sources: [
            {
              kind: 'manual',
              snapshots: [{ kind: 'manual', id: 'manual_1', content: longContent }],
            },
          ],
        }),
      }),
    );

    expect(createLiveBookMock.mock.calls[0][0].sources[0].snapshots[0].content).toHaveLength(6000);
  });
});
