'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BarChart2,
  TrendingUp,
  Users,
  Clock,
  Loader2,
  Brain,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { useAuth } from '@/features/auth/components/auth-provider';

interface ClassroomSummary {
  id: string;
  title: string;
  language?: string;
  createdAt: string;
  scenesCount: number;
  sceneTypes: string[];
}

interface ClassroomListResponse {
  success: boolean;
  classrooms?: ClassroomSummary[];
  error?: string;
}

interface StudentAbilityScore {
  metric: string;
  value: number;
  full_mark: number;
}

interface StudentLearningStats {
  records_total: number;
  records_14d: number;
  active_days_14: number;
  confusion_records: number;
  solved_records: number;
  top_subjects: string[];
  top_knowledge_points: string[];
  total_weight: number;
}

interface StudentLearningProfile {
  user_id: string;
  weak_subjects: string[];
  weak_knowledge_points: string[];
  recent_focus?: string | null;
  ability_scores: StudentAbilityScore[];
  learning_stats: StudentLearningStats;
  updated_at?: string | null;
  computed_at: string;
  profile_source: string;
}

interface StudentProfileResponse {
  success: boolean;
  profile?: StudentLearningProfile;
  error?: string;
}

interface AbilityScore {
  metric: string;
  value: number;
  fullMark: number;
}

interface WeakAbility extends AbilityScore {
  priority: '高' | '中' | '低';
  guidance: string;
}

interface BackendStudentProfileView {
  abilityData: AbilityScore[];
  weakAbilities: WeakAbility[];
  activeDays: number;
  records14d: number;
  solvedRecords: number;
  confusionRecords: number;
  topFocusText: string;
  trendDelta: number;
  trendText: string;
  learningRecordCount: number;
  learningSource: string;
  backendWeakSubjects: string[];
  backendWeakKnowledgePoints: string[];
  lookbackDays: number;
}

const WEAK_GUIDANCE_MAP: Record<string, string> = {
  概念理解: '回看最近课堂中的“讲解”场景，先梳理核心定义和易混概念。',
  练习表现: '把测验错题按题型分组，每组至少完成 2 题同类训练。',
  实践应用: '优先完成互动或项目型课堂，重点做“会做”到“会讲清楚”的迁移。',
  反思复盘: '每节课后用 3 句话写复盘：学到什么、哪里卡住、下次怎么做。',
  学习主动性: '将本周目标拆成 3 个可执行任务，并固定每日学习时间段。',
};

const PROFILE_LOOKBACK_DAYS = 180;

function clampScore(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export default function StatisticsPage() {
  const { user, loading: authLoading } = useAuth();
  const currentUserId = user?.id || '';
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [learningProfile, setLearningProfile] = useState<StudentLearningProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [profileErrorText, setProfileErrorText] = useState('');

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    async function loadClassrooms() {
      try {
        setLoading(true);
        setErrorText('');
        setProfileErrorText('');
        const response = await fetch('/api/classroom?limit=180', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json()) as ClassroomListResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '加载统计数据失败。');
        }

        let nextLearningProfile: StudentLearningProfile | null = null;
        if (currentUserId) {
          try {
            const profileResp = await fetch(
              `/api/students/${encodeURIComponent(currentUserId)}/profile?lookbackDays=${PROFILE_LOOKBACK_DAYS}`,
              {
                method: 'GET',
                cache: 'no-store',
              },
            );
            const profilePayload = (await profileResp.json()) as StudentProfileResponse;
            if (!profileResp.ok || !profilePayload.success || !profilePayload.profile) {
              throw new Error(profilePayload.error || '后端学生画像接口返回异常。');
            }
            nextLearningProfile = profilePayload.profile;
          } catch (profileError) {
            nextLearningProfile = null;
            if (!cancelled) {
              setProfileErrorText(
                profileError instanceof Error ? profileError.message : '后端学生画像加载失败。',
              );
            }
          }
        } else if (!cancelled) {
          setProfileErrorText('未检测到登录用户，无法加载后端画像。');
        }

        if (!cancelled) {
          setClassrooms(payload.classrooms || []);
          setLearningProfile(nextLearningProfile);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '统计数据加载失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadClassrooms();

    return () => {
      cancelled = true;
    };
  }, [authLoading, currentUserId]);

  const totals = useMemo(() => {
    const totalClassrooms = classrooms.length;
    const totalScenes = classrooms.reduce((sum, room) => sum + room.scenesCount, 0);
    const totalHours = (totalScenes * 8) / 60;
    const avgScenes = totalClassrooms ? totalScenes / totalClassrooms : 0;

    return {
      totalClassrooms,
      totalScenes,
      totalHours,
      avgScenes,
    };
  }, [classrooms]);

  const studentProfile = useMemo<BackendStudentProfileView | null>(() => {
    if (!learningProfile) return null;

    const abilityData: AbilityScore[] = (learningProfile.ability_scores || []).map((item) => ({
      metric: item.metric,
      value: clampScore(item.value, 0, item.full_mark || 100),
      fullMark: item.full_mark || 100,
    }));

    const weakAbilities: WeakAbility[] = [...abilityData]
      .sort((a, b) => a.value - b.value)
      .slice(0, 3)
      .map((ability) => {
        const gap = 100 - ability.value;
        const priority: '高' | '中' | '低' = gap >= 30 ? '高' : gap >= 18 ? '中' : '低';
        return {
          ...ability,
          priority,
          guidance: WEAK_GUIDANCE_MAP[ability.metric] || '建议通过针对性练习持续巩固。',
        };
      });

    const stats = learningProfile.learning_stats;
    const records14d = stats?.records_14d || 0;
    const solvedRecords = stats?.solved_records || 0;
    const confusionRecords = stats?.confusion_records || 0;
    const trendDelta = solvedRecords - confusionRecords;
    const topFocusText =
      (learningProfile.recent_focus || '').trim() ||
      (stats?.top_subjects?.length ? stats.top_subjects.join('、') : '暂无重点');

    return {
      abilityData,
      weakAbilities,
      activeDays: stats?.active_days_14 || 0,
      records14d,
      solvedRecords,
      confusionRecords,
      topFocusText,
      trendDelta,
      trendText: `画像窗口（近 ${PROFILE_LOOKBACK_DAYS} 天）已解决 ${solvedRecords} 条，困惑 ${confusionRecords} 条。`,
      learningRecordCount: stats?.records_total || 0,
      learningSource: learningProfile.profile_source,
      backendWeakSubjects: learningProfile.weak_subjects || [],
      backendWeakKnowledgePoints: learningProfile.weak_knowledge_points || [],
      lookbackDays: PROFILE_LOOKBACK_DAYS,
    };
  }, [learningProfile]);

  const profileUpdatedAt = useMemo(() => {
    const backendTs = learningProfile?.updated_at || learningProfile?.computed_at;
    if (!backendTs) return '未获取到后端画像';

    const parsed = new Date(backendTs).getTime();
    if (!Number.isFinite(parsed)) return '后端时间格式异常';

    return new Date(parsed).toLocaleDateString('zh-CN');
  }, [learningProfile]);

  if (loading) {
    return (
      <div className="h-[50vh] flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        正在加载统计数据...
      </div>
    );
  }

  if (errorText) {
    return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">{errorText}</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground tracking-wide uppercase">数据统计</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-card p-6 shadow-sm rounded-xl border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-muted-foreground tracking-wide">累计课堂时长</h3>
            <Clock className="h-4 w-4 text-gray-400" />
          </div>
          <p className="text-2xl font-bold text-foreground">{totals.totalHours.toFixed(1)}h</p>
          <div className="flex items-center gap-1 mt-2 text-[#4CAF50] text-xs font-bold">
            <TrendingUp className="h-3 w-3" />
            <span>基于真实课堂场景估算</span>
          </div>
        </div>

        <div className="bg-card p-6 shadow-sm rounded-xl border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-muted-foreground tracking-wide">课堂总数</h3>
            <Users className="h-4 w-4 text-gray-400" />
          </div>
          <p className="text-2xl font-bold text-foreground">{totals.totalClassrooms}</p>
          <div className="flex items-center gap-1 mt-2 text-[#4CAF50] text-xs font-bold">
            <TrendingUp className="h-3 w-3" />
            <span>来自 /api/classroom</span>
          </div>
        </div>

        <div className="bg-card p-6 shadow-sm rounded-xl border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-muted-foreground tracking-wide">平均场景数</h3>
            <BarChart2 className="h-4 w-4 text-gray-400" />
          </div>
          <p className="text-2xl font-bold text-foreground">{totals.avgScenes.toFixed(1)}</p>
          <div className="flex items-center gap-1 mt-2 text-[#4CAF50] text-xs font-bold">
            <TrendingUp className="h-3 w-3" />
            <span>每节课堂平均场景</span>
          </div>
        </div>

        <div className="bg-card p-6 shadow-sm rounded-xl border border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-muted-foreground tracking-wide">总场景数</h3>
            <ArrowUpRight className="h-4 w-4 text-gray-400" />
          </div>
          <p className="text-2xl font-bold text-foreground">{totals.totalScenes}</p>
          <div className="flex items-center gap-1 mt-2 text-[#4CAF50] text-xs font-bold">
            <TrendingUp className="h-3 w-3" />
            <span>讲解 + 测验 + 互动 + 项目</span>
          </div>
        </div>
      </div>

      <div className="bg-card p-6 shadow-sm rounded-xl border border-border space-y-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground tracking-wide flex items-center gap-2">
              <Brain className="h-5 w-5 text-[#E0573D]" />
              学生画像
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {learningProfile
                ? '来自后端学生画像接口（/v1/students/{user_id}/profile）'
                : '未获取到后端画像，请检查网关连接和学习记录。'}
            </p>
          </div>
          <span className="text-xs font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
            画像更新时间：{profileUpdatedAt}
          </span>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {!studentProfile ? (
            <div className="xl:col-span-12 border border-amber-200 bg-amber-50 text-amber-800 p-4">
              <p className="text-sm font-semibold">后端学生画像不可用</p>
              <p className="text-xs mt-2 leading-5">
                {profileErrorText ||
                  '当前没有拿到后端画像结果。请确认 AnotherMe2 网关已启动、ANOTHERME2_GATEWAY_BASE_URL 配置正确，且该用户已有学习记录。'}
              </p>
            </div>
          ) : (
            <>
          <div className="xl:col-span-5 border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-foreground tracking-wide uppercase">能力雷达图</h3>
              <span className="text-xs text-muted-foreground">满分 100</span>
            </div>
            <div className="min-h-[280px]">
              {studentProfile.abilityData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280} minWidth={0}>
                  <RadarChart data={studentProfile.abilityData}>
                    <PolarGrid stroke="#E5E7EB" />
                    <PolarAngleAxis dataKey="metric" tick={{ fill: '#374151', fontSize: 12 }} />
                    <PolarRadiusAxis
                      domain={[0, 100]}
                      tickCount={6}
                      tick={{ fill: '#9CA3AF', fontSize: 10 }}
                    />
                    <Radar
                      name="能力值"
                      dataKey="value"
                      stroke="#E0573D"
                      fill="#E0573D"
                      fillOpacity={0.28}
                      strokeWidth={2}
                    />
                    <RechartsTooltip
                      formatter={(value) => [`${value} 分`, '能力值']}
                      contentStyle={{
                        border: 'none',
                        borderRadius: '8px',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.08)',
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground bg-muted">
                  后端未返回能力维度分值
                </div>
              )}
            </div>
          </div>

          <div className="xl:col-span-4 border border-border p-4">
            <h3 className="text-sm font-bold text-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#E0573D]" />
              薄弱点分析
            </h3>
            <div className="space-y-4">
              {studentProfile.weakAbilities.length > 0 ? (
                studentProfile.weakAbilities.map((item) => (
                  <div key={item.metric} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">{item.metric}</p>
                        <p className="text-xs text-muted-foreground">{item.guidance}</p>
                      </div>
                      <span
                        className={`text-[10px] px-2 py-1 rounded-full whitespace-nowrap ${
                          item.priority === '高'
                            ? 'bg-red-100 text-red-700'
                            : item.priority === '中'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {item.priority}优先级
                      </span>
                    </div>
                    <progress
                      className="h-2 w-full [&::-moz-progress-bar]:bg-foreground [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-foreground"
                      value={item.value}
                      max={100}
                    />
                    <p className="text-xs text-muted-foreground">当前能力值：{item.value} / 100</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">后端未返回可用于薄弱项排序的能力分值。</p>
              )}

              {studentProfile.backendWeakSubjects.length > 0 ? (
                <div className="pt-2">
                  <p className="text-xs font-semibold text-foreground mb-2">后端识别薄弱学科</p>
                  <div className="flex flex-wrap gap-2">
                    {studentProfile.backendWeakSubjects.slice(0, 6).map((subject) => (
                      <span
                        key={`weak-subject-${subject}`}
                        className="text-[10px] px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-100"
                      >
                        {subject}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {studentProfile.backendWeakKnowledgePoints.length > 0 ? (
                <div className="pt-1">
                  <p className="text-xs font-semibold text-foreground mb-2">后端识别薄弱知识点</p>
                  <div className="flex flex-wrap gap-2">
                    {studentProfile.backendWeakKnowledgePoints.slice(0, 8).map((point) => (
                      <span
                        key={`weak-point-${point}`}
                        className="text-[10px] px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100"
                      >
                        {point}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="xl:col-span-3 border border-border p-4 flex flex-col">
            <h3 className="text-sm font-bold text-foreground tracking-wide uppercase mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#4A6FA5]" />
              近期学习情况总结
            </h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="bg-muted p-2.5">
                <p className="text-[11px] text-muted-foreground">近14天学习记录</p>
                <p className="text-base font-bold text-foreground">{studentProfile.records14d}</p>
              </div>
              <div className="bg-muted p-2.5">
                <p className="text-[11px] text-muted-foreground">活跃天数</p>
                <p className="text-base font-bold text-foreground">{studentProfile.activeDays}</p>
              </div>
              <div className="bg-muted p-2.5">
                <p className="text-[11px] text-muted-foreground">窗口内已解决</p>
                <p className="text-base font-bold text-foreground">{studentProfile.solvedRecords}</p>
              </div>
              <div className="bg-muted p-2.5">
                <p className="text-[11px] text-muted-foreground">窗口内困惑</p>
                <p className="text-base font-bold text-foreground">{studentProfile.confusionRecords}</p>
              </div>
            </div>
            <div className="space-y-2 text-xs text-muted-foreground leading-5">
              <p>
                近期学习重心：<span className="font-semibold text-foreground">{studentProfile.topFocusText}</span>
              </p>
              <p>{studentProfile.trendText}</p>
              {studentProfile.learningRecordCount > 0 ? (
                <p>
                  已融合
                  <span className="font-semibold text-foreground">
                    {' '}
                    {studentProfile.learningRecordCount}
                  </span>
                  条 AI 问答抽取记录（{studentProfile.learningSource}）。
                </p>
              ) : null}
              {studentProfile.weakAbilities.length > 0 ? (
                <p>
                  当前建议优先提升
                  <span className="font-semibold text-foreground">
                    {' '}
                    {studentProfile.weakAbilities[0].metric}
                  </span>
                  ，先做小步快跑式练习，再逐步提高题目复杂度。
                </p>
              ) : null}
            </div>
            <div className="mt-auto pt-4">
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                  studentProfile.trendDelta > 0
                    ? 'bg-emerald-100 text-emerald-700'
                    : studentProfile.trendDelta < 0
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-muted text-foreground'
                }`}
              >
                <TrendingUp className="h-3 w-3" />
                学习趋势
                {studentProfile.trendDelta > 0
                  ? '向好'
                  : studentProfile.trendDelta < 0
                    ? '需关注'
                    : '平稳'}
              </span>
            </div>
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
