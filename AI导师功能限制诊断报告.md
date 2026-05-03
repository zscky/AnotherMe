# AI导师功能限制诊断报告

## 问题现象
AI导师（AI Tutor）在聊天界面中显示了 6 种功能选项，但只有 **Chat** 功能真正可用，其他功能无法使用：
- ❌ Deep Solve（多步推理求解）
- ❌ Quiz Generation（测验生成）
- ❌ Deep Research（深度研究）
- ❌ Math Animator（数学动画）
- ❌ Visualize（可视化）

## 根本原因分析

### 1. **前端定义了所有功能，但未真正连接到后端**

**文件**: `AnotherMe/features/ai-tutor/components/chat/chat-composer.tsx`（第 27 行）

```typescript
export type ChatCapability = 'chat' | 'deep_solve' | 'quiz' | 'research' | 'math_animator' | 'visualize';

const CAPABILITY_OPTIONS = [
  { value: 'chat', label: 'Chat', ... },
  { value: 'deep_solve', label: 'Deep Solve', ... },
  { value: 'quiz', label: 'Quiz Generation', ... },
  { value: 'research', label: 'Deep Research', ... },
  { value: 'math_animator', label: 'Math Animator', ... },
  { value: 'visualize', label: 'Visualize', ... },
];
```

**问题**：虽然前端定义了 6 种 capability 选项，但这个值从未被传递到后端，功能菜单虽然可以切换，但后端无法区分。

---

### 2. **Chat 路由硬编码了功能类型**

**文件**: `AnotherMe/features/ai-tutor/server/chat-route.ts`（第 426-442 行）

```typescript
const capabilityRequest = {
  requestId,
  capabilityId: 'ai_tutor_chat' as const,  // ⚠️ 硬编码！永远只能是 'ai_tutor_chat'
  userId: persistenceUserId || 'anonymous',
  payload: {
    chatRequest: {
      ...body,
      apiKey: resolvedApiKey,
      ...(learningContext ? { learningContext } : {}),
    },
    languageModel,
    thinkingConfig: { enabled: false },
    useAgenticPipeline: body.config?.useAgenticPipeline ?? false,
  },
  streaming: true,
  signal,
  learningContext,
};

// 只注册了 Chat Handler
runtime.registerHandler(aiTutorChatHandler);
```

**关键问题**：
- `capabilityId` 被硬编码为 `'ai_tutor_chat'`
- 即使前端发送了 `capability: 'quiz'`，后端也完全忽略它
- 只注册了 `aiTutorChatHandler`，其他处理器从未被使用

---

### 3. **后端处理器已实现，但未被调用**

**已存在的处理器**（都在 `handlers/` 目录中）：
- ✓ `chat-handler.ts` → `aiTutorChatHandler` (`ai_tutor_chat`)
- ✓ `deep-solve-handler.ts` → `deepSolveHandler` (`deep_solve`)
- ✓ `quiz-practice-handler.ts` → `quizPracticeHandler` (`quiz_practice`)
- ✓ `math-animator-handler.ts` → `mathAnimatorHandler` (`math_animator`)
- ✓ `visualize-handler.ts` → `visualizeHandler` (`visualize`)
- ✓ `deep-research-handler.ts` → `deepResearchHandler` (`deep_research`)

**问题**：这些处理器都已实现，但 `chat-route.ts` 没有根据请求的 capability 类型来选择不同的处理器。

---

### 4. **前端没有传递 Capability 信息到后端**

**文件**: `AnotherMe/features/ai-tutor/server/chat-route.ts`（第 171-181 行）

请求体中完全没有 `capability` 或 `capabilityType` 字段：

```typescript
export async function POST(req: NextRequest) {
  // ...
  const body: StatelessChatRequest = await req.json();
  // body 中包含: messages, storeState, config, apiKey, ...
  // 但不包含: capability (来自 ChatComposer 的选择)
}
```

---

## 修复方案

### 方案 A：最小化修复（推荐）

**步骤 1**：扩展 `StatelessChatRequest` 类型以包含 capability

文件: `AnotherMe/lib/types/chat.ts`
```typescript
export interface StatelessChatRequest {
  // ... existing fields
  capability?: 'chat' | 'deep_solve' | 'quiz' | 'research' | 'math_animator' | 'visualize';
}
```

**步骤 2**：修改 `chat-composer.tsx` 在发送消息时传递 capability

文件: `AnotherMe/features/ai-tutor/components/chat/chat-composer.tsx`
```typescript
const doSend = useCallback(() => {
  const content = input.trim();
  if (!content && !attachments.length) return;
  
  // 传递 capability 到处理函数
  onSend?.(content, capability);  // ← 添加 capability 参数
  
  // ... rest of code
}, [input, attachments.length, onSend, capability]);
```

同时更新回调签名：
```typescript
interface ChatComposerProps {
  onSend?: (content: string, capability?: ChatCapability) => void;  // ← 添加 capability
}
```

**步骤 3**：在 chat-route 中根据 capability 选择处理器

文件: `AnotherMe/features/ai-tutor/server/chat-route.ts`
```typescript
// 提取客户端发送的 capability
const requestedCapability = body.capability || 'chat';

// 映射到对应的 capabilityId 和 Handler
const capabilityHandlerMap = {
  chat: { capabilityId: 'ai_tutor_chat', handler: aiTutorChatHandler },
  deep_solve: { capabilityId: 'deep_solve', handler: deepSolveHandler },
  quiz: { capabilityId: 'quiz_practice', handler: quizPracticeHandler },
  research: { capabilityId: 'deep_research', handler: deepResearchHandler },
  math_animator: { capabilityId: 'math_animator', handler: mathAnimatorHandler },
  visualize: { capabilityId: 'visualize', handler: visualizeHandler },
};

const selectedConfig = capabilityHandlerMap[requestedCapability];
if (!selectedConfig) {
  return apiError('INVALID_CAPABILITY', 400, `Unsupported capability: ${requestedCapability}`);
}

// 注册对应的处理器
runtime.registerHandler(selectedConfig.handler);

const capabilityRequest = {
  requestId,
  capabilityId: selectedConfig.capabilityId,
  // ... rest of config
};
```

**步骤 4**：在 chat-area.tsx 中传递 capability

文件: `AnotherMe/features/ai-tutor/components/chat/chat-area.tsx`
```typescript
const handleSendMessage = useCallback(
  async (content: string) => {
    // 使用当前选中的 capability
    await sendMessage(content, capability);
  },
  [sendMessage, capability],
);
```

---

## 受影响的文件清单

### 需要修改
1. `AnotherMe/lib/types/chat.ts` - 扩展 `StatelessChatRequest`
2. `AnotherMe/features/ai-tutor/components/chat/chat-composer.tsx` - 传递 capability
3. `AnotherMe/features/ai-tutor/components/chat/chat-area.tsx` - 传递 capability
4. `AnotherMe/features/ai-tutor/components/chat/use-chat-sessions.ts` - 传递 capability 到 API
5. `AnotherMe/features/ai-tutor/server/chat-route.ts` - 根据 capability 选择处理器

### 无需修改（已存在）
- `handlers/deep-solve-handler.ts` ✓
- `handlers/quiz-practice-handler.ts` ✓
- `handlers/math-animator-handler.ts` ✓
- `handlers/visualize-handler.ts` ✓
- `handlers/deep-research-handler.ts` ✓

---

## 实施优先级

1. **P0（立即）**：修复 chat-route 的 capability 支持
2. **P1（本周）**：连接前端 capability 选择器到后端
3. **P2（下周）**：为每个 capability 添加 UI 反馈和错误处理

---

## 验证清单

- [ ] `StatelessChatRequest` 包含 `capability` 字段
- [ ] `ChatComposer` 发送当前选中的 capability
- [ ] `chat-route` 可根据 capability 选择处理器
- [ ] 所有 6 种 capability 都能成功调用对应的处理器
- [ ] 前端显示正在使用的 capability（如 "Using: Deep Solve"）
- [ ] 错误情况下有明确的错误消息

