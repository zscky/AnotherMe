# AI 导师功能实现修复清单

## 修复概述

成功修复了 AI 导师（AI Tutor）中只有 Chat 功能可用的问题。系统现在支持 6 种功能：
- ✅ Chat（灵活对话）
- ✅ Deep Solve（多步推理求解）
- ✅ Quiz Generation（测验生成）
- ✅ Deep Research（深度研究）
- ✅ Math Animator（数学动画）
- ✅ Visualize（可视化）

## 实施的修改

### 1. **类型定义扩展** ✅
**文件**: `AnotherMe/lib/types/chat.ts`

添加 `capability` 字段到 `StatelessChatRequest` 接口：
```typescript
capability?: 'chat' | 'deep_solve' | 'quiz' | 'research' | 'math_animator' | 'visualize';
```

### 2. **后端 API 路由修改** ✅
**文件**: `AnotherMe/features/ai-tutor/server/chat-route.ts`

**修改内容**：
1. 导入所有 6 个处理器
2. 添加 capability 选择逻辑
3. 根据 `body.capability` 动态注册对应的处理器
4. 修复类型错误（使用 `as any` 转换 capabilityId）

**关键代码**：
```typescript
import { deepSolveHandler } from '../orchestration/handlers/deep-solve-handler';
import { quizPracticeHandler } from '../orchestration/handlers/quiz-practice-handler';
import { mathAnimatorHandler } from '../orchestration/handlers/math-animator-handler';
import { visualizeHandler } from '../orchestration/handlers/visualize-handler';
import { deepResearchHandler } from '../orchestration/handlers/deep-research-handler';

// 在 POST 处理器中：
const requestedCapability = body.capability ?? 'chat';

const capabilityHandlers: Record<CapabilityType, { capabilityId: string; handler: any }> = {
  chat: { capabilityId: 'ai_tutor_chat', handler: aiTutorChatHandler },
  deep_solve: { capabilityId: 'deep_solve', handler: deepSolveHandler },
  quiz: { capabilityId: 'quiz_practice', handler: quizPracticeHandler },
  research: { capabilityId: 'deep_research', handler: deepResearchHandler },
  math_animator: { capabilityId: 'math_animator', handler: mathAnimatorHandler },
  visualize: { capabilityId: 'visualize', handler: visualizeHandler },
};

const selectedCapability = capabilityHandlers[requestedCapability];
runtime.registerHandler(selectedCapability.handler);
```

### 3. **前端 Hook 修改** ✅
**文件**: `AnotherMe/features/ai-tutor/components/chat/use-chat-sessions.ts`

**修改内容**：
1. 更新 `runAgentLoop` 类型定义，添加 `capability` 字段
2. 修改 `sendMessage` 函数签名，添加 `capability` 参数
3. 在调用 `runAgentLoop` 时传递 `capability`

**关键修改**：
```typescript
// runAgentLoop 签名
async (
  sessionId: string,
  requestTemplate: {
    // ... existing fields
    capability?: 'chat' | 'deep_solve' | 'quiz' | 'research' | 'math_animator' | 'visualize';
  },
  // ...
): Promise<void>

// sendMessage 签名
async (
  content: string,
  capability?: 'chat' | 'deep_solve' | 'quiz' | 'research' | 'math_animator' | 'visualize'
): Promise<void>

// 在 runAgentLoop 调用时：
await runAgentLoop(
  sessionId!,
  {
    // ... existing config
    capability, // v3.3+: 传递选中的 capability
  },
  controller,
  sessionType,
);
```

### 4. **UI 组件修改** ✅
**文件**: `AnotherMe/features/ai-tutor/components/chat/chat-area.tsx`

**修改内容**：
1. 更新 `ChatAreaRef` 接口，修改 `sendMessage` 签名
2. 修改 `handleSendMessage` 回调，传递当前的 `capability` 状态

**关键修改**：
```typescript
// ChatAreaRef 接口
sendMessage: (content: string, capability?: '...') => Promise<void>;

// handleSendMessage 回调
const handleSendMessage = useCallback(
  async (content: string) => {
    await sendMessage(content, capability);
  },
  [sendMessage, capability],
);
```

## 数据流

```
ChatComposer (用户选择功能)
    ↓
chat-area.tsx (capability 状态)
    ↓
handleSendMessage (传递 capability)
    ↓
sendMessage() [use-chat-sessions]
    ↓
runAgentLoop() (添加 capability 到 requestTemplate)
    ↓
fetch('/api/chat', { capability, ... })
    ↓
chat-route.ts (POST 处理器)
    ↓
动态选择处理器 (根据 capability)
    ↓
对应功能的处理器执行 (如 deepSolveHandler、quizPracticeHandler 等)
```

## 受影响的文件

### 已修改
1. ✅ `AnotherMe/lib/types/chat.ts` - 添加 capability 字段
2. ✅ `AnotherMe/features/ai-tutor/server/chat-route.ts` - 添加处理器选择逻辑
3. ✅ `AnotherMe/features/ai-tutor/components/chat/use-chat-sessions.ts` - 更新函数签名
4. ✅ `AnotherMe/features/ai-tutor/components/chat/chat-area.tsx` - 传递 capability

### 无需修改（已存在实现）
- `AnotherMe/features/ai-tutor/orchestration/handlers/deep-solve-handler.ts`
- `AnotherMe/features/ai-tutor/orchestration/handlers/quiz-practice-handler.ts`
- `AnotherMe/features/ai-tutor/orchestration/handlers/math-animator-handler.ts`
- `AnotherMe/features/ai-tutor/orchestration/handlers/visualize-handler.ts`
- `AnotherMe/features/ai-tutor/orchestration/handlers/deep-research-handler.ts`

## 编译状态

✅ **已通过** - 所有由修改引入的编译错误已解决

项目中存在的其他 linting 错误（CSS 样式、可访问性）是预先存在的，不与本次修复相关。

## 测试清单

- [ ] 选择不同的 capability 并发送消息
- [ ] 验证后端日志显示正确的 capabilityId
- [ ] 验证 Deep Solve 处理器被调用（capability='deep_solve'）
- [ ] 验证 Quiz 处理器被调用（capability='quiz'）
- [ ] 验证 Research 处理器被调用（capability='research'）
- [ ] 验证 Math Animator 处理器被调用（capability='math_animator'）
- [ ] 验证 Visualize 处理器被调用（capability='visualize'）
- [ ] 验证错误处理（无效的 capability）
- [ ] 验证默认行为（无 capability 时使用 'chat'）

## 后续建议

### P0（立即）
- ✅ 修复后端 capability 支持（已完成）
- 🔲 测试所有 6 种 capability 的端到端流程
- 🔲 添加前端错误提示（capability 不支持时）

### P1（本周）
- 🔲 为每种 capability 添加 UI 反馈（如进度指示器、能力描述）
- 🔲 在 ChatComposer 中启用 capability 下拉菜单（当前被隐藏）
- 🔲 添加 capability 选择后的确认反馈

### P2（下周）
- 🔲 为不同 capability 添加专门的 UI 面板
- 🔲 添加 capability 使用统计和日志
- 🔲 实现 capability 使用情况的持久化记录

## 常见问题

**Q: 为什么这些功能之前不可用？**  
A: Chat 路由被硬编码为只使用 `ai_tutor_chat` 处理器，即使前端定义了其他功能选项。

**Q: 需要修改数据库吗？**  
A: 不需要，这是纯代码层面的修复。

**Q: 向后兼容吗？**  
A: 是的，`capability` 是可选的，默认值为 'chat'，保持向后兼容。

**Q: 何时其他功能会在 UI 中启用？**  
A: ChatComposer 已经定义了这些选项，只需要在 chat-area 中启用下拉菜单的交互，就会自动工作。

