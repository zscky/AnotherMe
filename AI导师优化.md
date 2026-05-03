我看完了。DeepTutor chat 里的“六个功能”不是六个独立页面，而是 chat composer 里可勾选的六个工具：`brainstorm`、`rag`、`web_search`、`code_execution`、`reason`、`paper_search`，定义在 [DeepTutor chat page](D:/AnotherMe-main/DeepTutor/web/app/(workspace)/chat/[[...sessionId]]/page.tsx:113)，后端工具包装在 [DeepTutor builtin tools](D:/AnotherMe-main/DeepTutor/deeptutor/tools/builtin/__init__.py:26)。

**结论**
不建议直接复制 DeepTutor 的前端组件到 AnotherMe。两个项目架构不同：

DeepTutor 是 `Next.js 前端 + Python FastAPI/WebSocket + Python 工具链`，chat 走 `thinking -> acting -> observing -> responding` 的 agentic pipeline，核心在 [agentic_pipeline.py](D:/AnotherMe-main/DeepTutor/deeptutor/agents/chat/agentic_pipeline.py:573)。

AnotherMe 的“AI导师”目前是 `Next.js API /api/chat + LangGraph 多智能体 + SSE`，消息请求结构在 [chat.ts](D:/AnotherMe-main/AnotherMe/lib/types/chat.ts:237)，主执行链在 [chat-handler.ts](D:/AnotherMe-main/AnotherMe/lib/orchestration/handlers/chat-handler.ts:43)。它现在支持白板/课堂 action，但还没有 DeepTutor 那种通用工具调用层。

**推荐做法**
在 AnotherMe 里原生实现一层 `AI Tutor Tools`，把 DeepTutor 的六个功能“按能力迁移”，而不是整体嵌入 DeepTutor 后端。

具体改造分四块：

1. **前端增加工具选择 UI**

在 AnotherMe 里，AI导师输入主要在 [roundtable/index.tsx](D:/AnotherMe-main/AnotherMe/components/roundtable/index.tsx:740) 和 [stage.tsx](D:/AnotherMe-main/AnotherMe/components/stage.tsx:476) 触发 `chatAreaRef.current?.sendMessage(text)`。

可以仿照 DeepTutor 的工具菜单实现一个小工具栏：

- Brainstorm：头脑风暴
- RAG：知识库
- Web Search：联网搜索
- Code：代码/计算
- Reason：深度推理
- Arxiv Search：论文检索

建议新增：

- `components/chat/tutor-tool-selector.tsx`
- `lib/types/tutor-tools.ts`
- 在 `Roundtable` 输入框旁加工具按钮
- 工具状态放到 `useSettingsStore` 或 `useChatSessions` 的 request-scoped state

2. **扩展 /api/chat 请求协议**

在 [StatelessChatRequest](D:/AnotherMe-main/AnotherMe/lib/types/chat.ts:237) 的 `config` 里加：

```ts
enabledTutorTools?: TutorToolName[];
tutorToolConfig?: {
  knowledgeBase?: string;
  maxPaperResults?: number;
  codeTimeoutSec?: number;
};
```

然后在 [use-chat-sessions.ts](D:/AnotherMe-main/AnotherMe/components/chat/use-chat-sessions.ts:1029) 发送消息时把当前勾选工具带到 `/api/chat`。

3. **后端新增工具注册与执行层**

建议新增目录：

```txt
AnotherMe/lib/orchestration/tutor-tools/
  types.ts
  registry.ts
  brainstorm.ts
  reason.ts
  web-search.ts
  rag.ts
  code-execution.ts
  paper-search.ts
```

六个工具的迁移方式：

- `brainstorm`：用 `callLLM` 做一次发散式提示词调用，最容易。
- `reason`：用 `callLLM` 做一次深度推理子调用，和 brainstorm 类似。
- `web_search`：直接复用已有的 [Tavily 搜索实现](D:/AnotherMe-main/AnotherMe/lib/web-search/tavily.ts:17)。
- `paper_search`：移植 DeepTutor 的 arXiv 查询逻辑，做成 TS fetch 版本。
- `rag`：不能直接复制 DeepTutor，因为 AnotherMe 没有同样的知识库索引服务。短期可先检索课堂笔记、ClassroomBook、学习记录；长期再接向量库。
- `code_execution`：必须单独做沙箱。不要让模型直接执行任意 Node/PowerShell。建议只支持 Python，临时目录、超时、无网络、输出截断。

同时更新 [capability-registry.ts](D:/AnotherMe-main/AnotherMe/lib/orchestration/capability-registry.ts:20)，把 `ToolId` 扩展为包含：

```ts
'brainstorm' | 'rag' | 'code_execution' | 'reason' | 'paper_search'
```

4. **把工具结果接入 AI导师生成链**

这里有两种路线。

推荐先做 **v1：工具预执行 + 注入上下文**：

- 用户勾选工具
- `/api/chat` 收到请求
- 在进入 `aiTutorChatHandler` 前执行相关工具
- 把工具结果写入 `learningContext` 或 `config.systemPromptAddendum`
- AI导师基于这些结果回答

优点是改动小，不破坏现有多智能体、白板 action、课堂状态流。

后续再做 **v2：真正 agentic tool calling**：

- 类似 DeepTutor 的 `thinking -> acting -> observing -> responding`
- 模型先决定调哪些工具
- 工具并行执行
- 工具调用/结果作为 SSE trace 发给前端
- 最终回答融合工具结果

这个更接近 DeepTutor，但会改动 [director-graph.ts](D:/AnotherMe-main/AnotherMe/lib/orchestration/director-graph.ts:325) 和 [AISdkLangGraphAdapter](D:/AnotherMe-main/AnotherMe/lib/orchestration/ai-sdk-adapter.ts:126)，因为现在 `streamGenerate` 没有真正把 `tools` 传进 `streamLLM`。

**最小落地顺序**
1. 先加类型和 UI：六个工具能勾选，并随 `/api/chat` 发送。
2. 先实现 `brainstorm`、`reason`、`web_search`、`paper_search`。
3. 再做 `rag` 的本项目数据源映射。
4. 最后做 `code_execution`，因为安全和沙箱成本最高。
5. 工具结果先作为隐藏上下文注入 AI导师回答；后面再补工具调用 trace 面板。

这样做最稳：能把 DeepTutor chat 的六个能力完整迁移进 AnotherMe 的“AI导师”，同时不打断你现在课堂、白板、多智能体、学习记录抽取这些已有链路。