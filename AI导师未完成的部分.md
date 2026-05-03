# AI导师未完成的部分

## 已完成

### P1: 工具选择器 (Tool Selector)
**状态**: ✅ 已完成

- [x] 实现工具选择器组件 `tutor-tool-selector.tsx`
- [x] 支持六个AI导师工具的选择/取消
- [x] 集成到聊天输入框
- [x] 在发送消息时传递选中的工具列表

**相关文件**:
- `AnotherMe/components/chat/tutor-tool-selector.tsx` - 工具选择器组件
- `AnotherMe/lib/types/tutor-tools.ts` - 工具类型定义
- `AnotherMe/components/chat/chat-input.tsx` - 集成到聊天输入框
- `AnotherMe/components/chat/use-chat-sessions.ts` - 传递工具配置到API

---

### P2: 真正的Agentic Tool Calling (DeepTutor等价)
**状态**: ✅ 已完成

**实现内容**:
- [x] 将六工具包装为AI SDK tools格式 (`ai-sdk-tools.ts`)
- [x] 实现 `thinking -> acting -> observing -> responding` 四阶段pipeline
- [x] 支持模型按需选择工具，而非预执行全部
- [x] 添加 `useAgenticPipeline` 配置选项
- [x] 更新工具选择器UI，添加模式切换开关

**核心实现**:
1. **AI SDK Tools 定义** (`lib/orchestration/tutor-tools/ai-sdk-tools.ts`)
   - 使用 `AsyncLocalStorage` 传递工具执行上下文
   - 六个工具全部包装为AI SDK tool格式
   - 支持工具执行前后的回调钩子

2. **Agentic Pipeline** (`lib/orchestration/agentic-pipeline.ts`)
   - Stage 1: Thinking - 模型分析问题并规划
   - Stage 2: Acting - 模型按需调用工具
   - Stage 3: Observing - 模型分析工具结果
   - Stage 4: Responding - 生成最终回答

3. **Chat Handler 更新** (`lib/orchestration/handlers/chat-handler.ts`)
   - 支持两种模式：
     - `useAgenticPipeline = true`: 使用四阶段pipeline
     - `useAgenticPipeline = false`: 预执行所有工具（legacy）

4. **类型定义更新**:
   - `lib/types/chat.ts` - StatelessChatRequest.config 添加 useAgenticPipeline
   - `lib/types/tutor-tools.ts` - TutorToolState 添加 useAgenticPipeline

5. **UI更新** (`components/chat/tutor-tool-selector.tsx`)
   - 添加 Agentic/预执行 模式切换开关
   - 显示当前模式状态

**参考实现**: DeepTutor `lib/agents/chat/agentic_pipeline.py`

---

## 待完成

### P3: 工具执行过程可视化 (DeepTutor等价)
**状态**: ⏳ 待完成

**目标**: 在聊天界面中展示工具执行过程，参考 DeepTutor 的 `ToolCallDisplay`

**参考实现**:
```python
# DeepTutor 参考
lib/agents/chat/components/tool_call_display.py
lib/agents/chat/components/tool_call_display.css
```

**实现要点**:
- [ ] 创建 `ToolCallDisplay` 组件
- [ ] 展示工具调用状态（等待中/执行中/完成/错误）
- [ ] 支持展开/折叠查看工具参数和结果
- [ ] 美观的动画效果

---

### P4: 工具结果展示 (DeepTutor等价)
**状态**: ⏳ 待完成

**目标**: 在聊天界面中展示工具执行结果，参考 DeepTutor 的 `ToolResultDisplay`

**参考实现**:
```python
# DeepTutor 参考
lib/agents/chat/components/tool_result_display.py
lib/agents/chat/components/tool_result_display.css
```

**实现要点**:
- [ ] 创建 `ToolResultDisplay` 组件
- [ ] 根据工具类型展示不同格式的结果
  - 代码执行: 显示代码和输出
  - 搜索: 显示搜索结果列表
  - RAG: 显示引用来源
- [ ] 支持复制结果内容

---

### P5: 工具调用历史记录
**状态**: ⏳ 待完成

**目标**: 保存和展示工具调用历史

**实现要点**:
- [ ] 设计工具调用历史的数据结构
- [ ] 在数据库中存储工具调用记录
- [ ] 提供历史记录查询接口
- [ ] 在UI中展示历史记录

---

## 技术债务

### T1: 工具执行错误处理优化
**状态**: ⏳ 待完成

当前工具执行错误处理较为简单，需要：
- [ ] 细化错误类型
- [ ] 添加重试机制
- [ ] 更好的错误信息展示

### T2: 工具性能优化
**状态**: ⏳ 待完成

- [ ] 添加工具执行超时控制
- [ ] 优化并行工具执行
- [ ] 添加工具执行缓存

---

## 备注

### 关于 DeepTutor 的参考

DeepTutor 的 Agentic Pipeline 实现位于:
- `DeepTutor/deeptutor/agents/chat/agentic_pipeline.py` - 核心pipeline
- `DeepTutor/deeptutor/agents/chat/components/` - UI组件

### 当前架构

```
用户勾选工具 -> 发送消息
    |
    v
[两种模式]
1. Legacy模式 (useAgenticPipeline=false):
   预执行所有工具 -> 将结果附加到prompt -> 生成回答

2. Agentic模式 (useAgenticPipeline=true):
   Thinking -> Acting(按需调用工具) -> Observing -> Responding
```

### 已完成文件清单

**P2 新增/修改文件**:
```
lib/orchestration/tutor-tools/ai-sdk-tools.ts      # 新增: AI SDK tools包装
lib/orchestration/agentic-pipeline.ts              # 新增: 四阶段pipeline
lib/orchestration/handlers/chat-handler.ts         # 修改: 支持两种模式
lib/types/chat.ts                                  # 修改: 添加useAgenticPipeline
lib/types/tutor-tools.ts                           # 修改: 添加useAgenticPipeline
components/chat/tutor-tool-selector.tsx            # 修改: 添加模式切换UI
components/chat/use-chat-sessions.ts               # 修改: 传递配置
app/api/chat/route.ts                              # 修改: 传递配置到handler
```
