'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Sparkles, AlertCircle, AlertTriangle, ArrowLeft, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store/stage';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { getAvailableProvidersWithVoices } from '@/lib/audio/voice-resolver';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  loadImageMapping,
  loadPdfBlob,
  cleanupOldImages,
  storeImages,
} from '@/lib/utils/image-storage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { db } from '@/lib/utils/database';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { nanoid } from 'nanoid';
import type { Stage } from '@/lib/types/stage';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import { AgentRevealModal } from '@/features/classroom/components/agent/agent-reveal-modal';
import { createLogger } from '@/lib/logger';
import { REQUIRED_CLASSROOM_AGENT_IDS } from '@/lib/orchestration/registry/classroom-presets';
import { type GenerationSessionState, ALL_STEPS, getActiveSteps } from './types';
import { StepVisualizer } from './components/visualizers';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

const log = createLogger('GenerationPreview');

export function GenerationPreviewContent() {
  const router = useRouter();
  const { t } = useI18n();
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [session, setSession] = useState<GenerationSessionState | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isComplete] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [streamingOutlines, setStreamingOutlines] = useState<SceneOutline[] | null>(null);
  const [truncationWarnings, setTruncationWarnings] = useState<string[]>([]);
  const [webSearchSources, setWebSearchSources] = useState<Array<{ title: string; url: string }>>(
    [],
  );
  const [showAgentReveal, setShowAgentReveal] = useState(false);
  const [generatedAgents, setGeneratedAgents] = useState<
    Array<{
      id: string;
      name: string;
      role: string;
      persona: string;
      avatar: string;
      color: string;
      priority: number;
    }>
  >([]);
  const agentRevealResolveRef = useRef<(() => void) | null>(null);

  // Compute active steps based on session state
  const activeSteps = getActiveSteps(session);

  // Load session from sessionStorage
  useEffect(() => {
    cleanupOldImages(24).catch((e) => log.error(e));

    const saved = sessionStorage.getItem('generationSession');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as GenerationSessionState;
        setSession(parsed);
      } catch (e) {
        log.error('Failed to parse generation session:', e);
      }
    }
    setSessionLoaded(true);
  }, []);

  // Abort all in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Get API credentials from localStorage
  const getApiHeaders = () => {
    const modelConfig = getCurrentModelConfig();
    const settings = useSettingsStore.getState();
    const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
    const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];
    return {
      'Content-Type': 'application/json',
      'x-model': modelConfig.modelString,
      'x-api-key': modelConfig.apiKey,
      'x-base-url': modelConfig.baseUrl,
      'x-provider-type': modelConfig.providerType || '',
      'x-requires-api-key': modelConfig.requiresApiKey ? 'true' : 'false',
      // Image generation provider
      'x-image-provider': settings.imageProviderId || '',
      'x-image-model': settings.imageModelId || '',
      'x-image-api-key': imageProviderConfig?.apiKey || '',
      'x-image-base-url': imageProviderConfig?.baseUrl || '',
      // Video generation provider
      'x-video-provider': settings.videoProviderId || '',
      'x-video-model': settings.videoModelId || '',
      'x-video-api-key': videoProviderConfig?.apiKey || '',
      'x-video-base-url': videoProviderConfig?.baseUrl || '',
      // Media generation toggles
      'x-image-generation-enabled': String(settings.imageGenerationEnabled ?? false),
      'x-video-generation-enabled': String(settings.videoGenerationEnabled ?? false),
    };
  };

  // Auto-start generation when session is loaded
  useEffect(() => {
    if (session && !hasStartedRef.current) {
      hasStartedRef.current = true;
      startGeneration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Main generation flow
  const startGeneration = async () => {
    if (!session) return;

    // Create AbortController for this generation run
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    const settingsState = useSettingsStore.getState();
    if (!settingsState.autoConfigApplied) {
      await settingsState.fetchServerProviders();
    }

    const modelConfig = getCurrentModelConfig();
    if (!modelConfig.modelId) {
      setError(t('settings.modelNotConfigured'));
      return;
    }
    if (modelConfig.requiresApiKey && !modelConfig.apiKey && !modelConfig.isServerConfigured) {
      setError(`${t('settings.setupNeeded')}: ${t('settings.apiKeyDesc')}`);
      return;
    }

    // Use a local mutable copy so we can update it after PDF parsing
    let currentSession = session;

    setError(null);
    setCurrentStepIndex(0);

    try {
      // Compute active steps for this session (recomputed after session mutations)
      let activeSteps = getActiveSteps(currentSession);

      // Determine if we need the PDF analysis step
      const hasPdfToAnalyze = !!currentSession.pdfStorageKey && !currentSession.pdfText;
      // If no PDF to analyze, skip to the next available step
      if (!hasPdfToAnalyze) {
        const firstNonPdfIdx = activeSteps.findIndex((s) => s.id !== 'pdf-analysis');
        setCurrentStepIndex(Math.max(0, firstNonPdfIdx));
      }

      // Step 0: Parse PDF if needed
      if (hasPdfToAnalyze) {
        log.debug('=== Generation Preview: Parsing PDF ===');
        const pdfBlob = await loadPdfBlob(currentSession.pdfStorageKey!);
        if (!pdfBlob) {
          throw new Error(t('generation.pdfLoadFailed'));
        }

        // Ensure pdfBlob is a valid Blob with content
        if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
          log.error('Invalid PDF blob:', {
            type: typeof pdfBlob,
            size: pdfBlob instanceof Blob ? pdfBlob.size : 'N/A',
          });
          throw new Error(t('generation.pdfLoadFailed'));
        }

        // Wrap as a File to guarantee multipart/form-data with correct content-type
        const pdfFile = new File([pdfBlob], currentSession.pdfFileName || 'document.pdf', {
          type: 'application/pdf',
        });

        const parseFormData = new FormData();
        parseFormData.append('pdf', pdfFile);

        if (currentSession.pdfProviderId) {
          parseFormData.append('providerId', currentSession.pdfProviderId);
        }
        if (currentSession.pdfProviderConfig?.apiKey?.trim()) {
          parseFormData.append('apiKey', currentSession.pdfProviderConfig.apiKey);
        }
        if (currentSession.pdfProviderConfig?.baseUrl?.trim()) {
          parseFormData.append('baseUrl', currentSession.pdfProviderConfig.baseUrl);
        }

        const parseResponse = await fetch('/api/parse-pdf', {
          method: 'POST',
          body: parseFormData,
          signal,
        });

        if (!parseResponse.ok) {
          const errorData = await parseResponse.json();
          throw new Error(errorData.error || t('generation.pdfParseFailed'));
        }

        const parseResult = await parseResponse.json();
        if (!parseResult.success || !parseResult.data) {
          throw new Error(t('generation.pdfParseFailed'));
        }

        let pdfText = parseResult.data.text as string;

        // Truncate if needed
        if (pdfText.length > MAX_PDF_CONTENT_CHARS) {
          pdfText = pdfText.substring(0, MAX_PDF_CONTENT_CHARS);
        }

        // Create image metadata and store images
        // Prefer metadata.pdfImages (both parsers now return this)
        const rawPdfImages = parseResult.data.metadata?.pdfImages;
        const images = rawPdfImages
          ? rawPdfImages.map(
              (img: {
                id: string;
                src?: string;
                pageNumber?: number;
                description?: string;
                width?: number;
                height?: number;
              }) => ({
                id: img.id,
                src: img.src || '',
                pageNumber: img.pageNumber || 1,
                description: img.description,
                width: img.width,
                height: img.height,
              }),
            )
          : (parseResult.data.images as string[]).map((src: string, i: number) => ({
              id: `img_${i + 1}`,
              src,
              pageNumber: 1,
            }));

        const imageStorageIds = await storeImages(images);

        const pdfImages: PdfImage[] = images.map(
          (
            img: {
              id: string;
              src: string;
              pageNumber: number;
              description?: string;
              width?: number;
              height?: number;
            },
            i: number,
          ) => ({
            id: img.id,
            src: '',
            pageNumber: img.pageNumber,
            description: img.description,
            width: img.width,
            height: img.height,
            storageId: imageStorageIds[i],
          }),
        );

        // Update session with parsed PDF data
        const updatedSession = {
          ...currentSession,
          pdfText,
          pdfImages,
          imageStorageIds,
          pdfStorageKey: undefined, // Clear so we don't re-parse
        };
        setSession(updatedSession);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSession));

        // Truncation warnings
        const warnings: string[] = [];
        if ((parseResult.data.text as string).length > MAX_PDF_CONTENT_CHARS) {
          warnings.push(t('generation.textTruncated', { n: MAX_PDF_CONTENT_CHARS }));
        }
        if (images.length > MAX_VISION_IMAGES) {
          warnings.push(
            t('generation.imageTruncated', { total: images.length, max: MAX_VISION_IMAGES }),
          );
        }
        if (warnings.length > 0) {
          setTruncationWarnings(warnings);
        }

        // Reassign local reference for subsequent steps
        currentSession = updatedSession;
        activeSteps = getActiveSteps(currentSession);
      }

      // Step: Web Search (if enabled)
      const webSearchStepIdx = activeSteps.findIndex((s) => s.id === 'web-search');
      if (currentSession.requirements.webSearch && webSearchStepIdx >= 0) {
        setCurrentStepIndex(webSearchStepIdx);
        setWebSearchSources([]);

        const wsSettings = useSettingsStore.getState();
        const wsApiKey =
          wsSettings.webSearchProvidersConfig?.[wsSettings.webSearchProviderId]?.apiKey;
        const res = await fetch('/api/web-search', {
          method: 'POST',
          headers: getApiHeaders(),
          body: JSON.stringify({
            query: currentSession.requirements.requirement,
            pdfText: currentSession.pdfText || undefined,
            apiKey: wsApiKey || undefined,
          }),
          signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Web search failed' }));
          throw new Error(data.error || t('generation.webSearchFailed'));
        }

        const searchData = await res.json();
        const sources = (searchData.sources || []).map((s: { title: string; url: string }) => ({
          title: s.title,
          url: s.url,
        }));
        setWebSearchSources(sources);

        const updatedSessionWithSearch = {
          ...currentSession,
          researchContext: searchData.context || '',
          researchSources: sources,
        };
        setSession(updatedSessionWithSearch);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSessionWithSearch));
        currentSession = updatedSessionWithSearch;
        activeSteps = getActiveSteps(currentSession);
      }

      // Load imageMapping early (needed for both outline and scene generation)
      let imageMapping: ImageMapping = {};
      if (currentSession.imageStorageIds && currentSession.imageStorageIds.length > 0) {
        log.debug('Loading images from IndexedDB');
        imageMapping = await loadImageMapping(currentSession.imageStorageIds);
      } else if (
        currentSession.imageMapping &&
        Object.keys(currentSession.imageMapping).length > 0
      ) {
        log.debug('Using imageMapping from session (old format)');
        imageMapping = currentSession.imageMapping;
      }

      // ── Agent generation (before outlines so persona can influence structure) ──
      const settings = useSettingsStore.getState();
      let agents: Array<{
        id: string;
        name: string;
        role: string;
        persona?: string;
      }> = [];

      // Create stage client-side (needed for agent generation stageId)
      const stageId = nanoid(10);
      const stage: Stage = {
        id: stageId,
        name: extractTopicFromRequirement(currentSession.requirements.requirement),
        description: '',
        language: currentSession.requirements.language || 'zh-CN',
        style: 'professional',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      if (settings.agentMode === 'auto') {
        const agentStepIdx = activeSteps.findIndex((s) => s.id === 'agent-generation');
        if (agentStepIdx >= 0) setCurrentStepIndex(agentStepIdx);

        try {
          const allAvatars = [
            {
              path: '/avatars/teacher.png',
              desc: 'Male teacher with glasses, holding a book, green background',
            },
            {
              path: '/avatars/teacher-2.png',
              desc: 'Female teacher with long dark hair, blue traditional outfit, gentle expression',
            },
            {
              path: '/avatars/assist.png',
              desc: 'Young female assistant with glasses, pink background, friendly smile',
            },
            {
              path: '/avatars/assist-2.png',
              desc: 'Young female in orange top and purple overalls, cheerful and approachable',
            },
            {
              path: '/avatars/clown.png',
              desc: 'Energetic girl with glasses pointing up, green shirt, lively and fun',
            },
            {
              path: '/avatars/clown-2.png',
              desc: 'Playful girl with curly hair doing rock gesture, blue shirt, humorous vibe',
            },
            {
              path: '/avatars/curious.png',
              desc: 'Surprised boy with glasses, hand on cheek, curious expression',
            },
            {
              path: '/avatars/curious-2.png',
              desc: 'Boy with backpack holding a book and question mark bubble, inquisitive',
            },
            {
              path: '/avatars/note-taker.png',
              desc: 'Studious boy with glasses, blue shirt, calm and organized',
            },
            {
              path: '/avatars/note-taker-2.png',
              desc: 'Active boy with yellow backpack waving, blue outfit, enthusiastic learner',
            },
            {
              path: '/avatars/thinker.png',
              desc: 'Thoughtful girl with hand on chin, purple background, contemplative',
            },
            {
              path: '/avatars/thinker-2.png',
              desc: 'Girl reading a book intently, long dark hair, intellectual and focused',
            },
          ];

          const getAvailableVoicesForGeneration = () => {
            const providers = getAvailableProvidersWithVoices(settings.ttsProvidersConfig);
            return providers.flatMap((p) =>
              p.voices.map((v) => ({
                providerId: p.providerId,
                voiceId: v.id,
                voiceName: v.name,
              })),
            );
          };

          // No outlines yet — agent generation uses only stage name + description
          const agentResp = await fetch('/api/generate/agent-profiles', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
              stageInfo: { name: stage.name, description: stage.description },
              language: currentSession.requirements.language || 'zh-CN',
              availableAvatars: allAvatars.map((a) => a.path),
              avatarDescriptions: allAvatars.map((a) => ({ path: a.path, desc: a.desc })),
              availableVoices: getAvailableVoicesForGeneration(),
            }),
            signal,
          });

          if (!agentResp.ok) throw new Error('Agent generation failed');
          const agentData = await agentResp.json();
          if (!agentData.success) throw new Error(agentData.error || 'Agent generation failed');

          // Save to IndexedDB and registry
          const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
          const savedIds = await saveGeneratedAgents(stage.id, agentData.agents);
          settings.setSelectedAgentIds(savedIds);
          stage.agentIds = savedIds;

          // Show card-reveal modal, continue generation once all cards are revealed
          setGeneratedAgents(agentData.agents);
          setShowAgentReveal(true);
          await new Promise<void>((resolve) => {
            agentRevealResolveRef.current = resolve;
          });

          agents = savedIds
            .map((id) => useAgentRegistry.getState().getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
        } catch (err: unknown) {
          log.warn('[Generation] Agent generation failed, falling back to presets:', err);
          const registry = useAgentRegistry.getState();
          const fallbackIds = settings.selectedAgentIds.filter((id) => {
            const a = registry.getAgent(id);
            return a && !a.isGenerated;
          });
          for (const requiredId of REQUIRED_CLASSROOM_AGENT_IDS) {
            const requiredAgent = registry.getAgent(requiredId);
            if (requiredAgent && !requiredAgent.isGenerated && !fallbackIds.includes(requiredId)) {
              fallbackIds.push(requiredId);
            }
          }
          agents = fallbackIds
            .map((id) => registry.getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
          stage.agentIds = fallbackIds;
        }
      } else {
        // Preset mode — use selected agents (include persona)
        // Filter out stale generated agent IDs that may linger in settings
        const registry = useAgentRegistry.getState();
        const presetAgentIds = settings.selectedAgentIds.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        for (const requiredId of REQUIRED_CLASSROOM_AGENT_IDS) {
          const requiredAgent = registry.getAgent(requiredId);
          if (requiredAgent && !requiredAgent.isGenerated && !presetAgentIds.includes(requiredId)) {
            presetAgentIds.push(requiredId);
          }
        }
        agents = presetAgentIds
          .map((id) => registry.getAgent(id))
          .filter(Boolean)
          .map((a) => ({
            id: a!.id,
            name: a!.name,
            role: a!.role,
            persona: a!.persona,
          }));
        stage.agentIds = presetAgentIds;
      }

      // ── Generate outlines (with agent personas for teacher context) ──
      let outlines = currentSession.sceneOutlines;

      const outlineStepIdx = activeSteps.findIndex((s) => s.id === 'outline');
      setCurrentStepIndex(outlineStepIdx >= 0 ? outlineStepIdx : 0);
      if (!outlines || outlines.length === 0) {
        log.debug('=== Generating outlines (SSE) ===');
        setStreamingOutlines([]);

        outlines = await new Promise<SceneOutline[]>((resolve, reject) => {
          const collected: SceneOutline[] = [];

          fetch('/api/generate/scene-outlines-stream', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
              requirements: currentSession.requirements,
              pdfText: currentSession.pdfText,
              pdfImages: currentSession.pdfImages,
              imageMapping,
              researchContext: currentSession.researchContext,
              agents,
            }),
            signal,
          })
            .then((res) => {
              if (!res.ok) {
                return res.json().then((d) => {
                  reject(new Error(d.error || t('generation.outlineGenerateFailed')));
                });
              }

              const reader = res.body?.getReader();
              if (!reader) {
                reject(new Error(t('generation.streamNotReadable')));
                return;
              }

              const decoder = new TextDecoder();
              let sseBuffer = '';

              const pump = (): Promise<void> =>
                reader.read().then(({ done, value }) => {
                  if (value) {
                    sseBuffer += decoder.decode(value, { stream: !done });
                    const lines = sseBuffer.split('\n');
                    sseBuffer = lines.pop() || '';

                    for (const line of lines) {
                      if (!line.startsWith('data: ')) continue;
                      try {
                        const evt = JSON.parse(line.slice(6));
                        if (evt.type === 'outline') {
                          collected.push(evt.data);
                          setStreamingOutlines([...collected]);
                        } else if (evt.type === 'retry') {
                          collected.length = 0;
                          setStreamingOutlines([]);
                          setStatusMessage(t('generation.outlineRetrying'));
                        } else if (evt.type === 'done') {
                          resolve(evt.outlines || collected);
                          return;
                        } else if (evt.type === 'error') {
                          reject(new Error(evt.error));
                          return;
                        }
                      } catch (e) {
                        log.error('Failed to parse outline SSE:', line, e);
                      }
                    }
                  }
                  if (done) {
                    if (collected.length > 0) {
                      resolve(collected);
                    } else {
                      reject(new Error(t('generation.outlineEmptyResponse')));
                    }
                    return;
                  }
                  return pump();
                });

              pump().catch(reject);
            })
            .catch(reject);
        });

        const updatedSession = { ...currentSession, sceneOutlines: outlines };
        setSession(updatedSession);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSession));

        // Outline generation succeeded — clear homepage draft cache
        try {
          localStorage.removeItem('requirementDraft');
        } catch {
          /* ignore */
        }

        // Brief pause to let user see the final outline state
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      // Move to scene generation step
      setStatusMessage('');
      if (!outlines || outlines.length === 0) {
        throw new Error(t('generation.outlineEmptyResponse'));
      }

      // Store stage and outlines
      const store = useStageStore.getState();
      store.setStage(stage);
      store.setOutlines(outlines);

      // Advance to slide-content step
      const contentStepIdx = activeSteps.findIndex((s) => s.id === 'slide-content');
      if (contentStepIdx >= 0) setCurrentStepIndex(contentStepIdx);

      // Build stageInfo and userProfile for API call
      const stageInfo = {
        name: stage.name,
        description: stage.description,
        language: stage.language,
        style: stage.style,
      };

      const userProfile =
        currentSession.requirements.userNickname || currentSession.requirements.userBio
          ? `Student: ${currentSession.requirements.userNickname || 'Unknown'}${currentSession.requirements.userBio ? ` — ${currentSession.requirements.userBio}` : ''}`
          : undefined;

      // Generate ONLY the first scene
      store.setGeneratingOutlines(outlines);

      const firstOutline = outlines[0];

      // Step 2: Generate content (currentStepIndex is already 2)
      const contentResp = await fetch('/api/generate/scene-content', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          outline: firstOutline,
          allOutlines: outlines,
          pdfImages: currentSession.pdfImages,
          imageMapping,
          stageInfo,
          stageId: stage.id,
          agents,
        }),
        signal,
      });

      if (!contentResp.ok) {
        const errorData = await contentResp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || t('generation.sceneGenerateFailed'));
      }

      const contentData = await contentResp.json();
      if (!contentData.success || !contentData.content) {
        throw new Error(contentData.error || t('generation.sceneGenerateFailed'));
      }

      // Generate actions (activate actions step indicator)
      const actionsStepIdx = activeSteps.findIndex((s) => s.id === 'actions');
      setCurrentStepIndex(actionsStepIdx >= 0 ? actionsStepIdx : currentStepIndex + 1);

      const actionsResp = await fetch('/api/generate/scene-actions', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          outline: contentData.effectiveOutline || firstOutline,
          allOutlines: outlines,
          content: contentData.content,
          stageId: stage.id,
          agents,
          previousSpeeches: [],
          userProfile,
        }),
        signal,
      });

      if (!actionsResp.ok) {
        const errorData = await actionsResp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || t('generation.sceneGenerateFailed'));
      }

      const data = await actionsResp.json();
      if (!data.success || !data.scene) {
        throw new Error(data.error || t('generation.sceneGenerateFailed'));
      }

      // Generate TTS for first scene (part of actions step — blocking)
      if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
        const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
        const speechActions = (data.scene.actions || []).filter(
          (a: { type: string; text?: string }) => a.type === 'speech' && a.text,
        );

        let ttsFailCount = 0;
        for (const action of speechActions) {
          const audioId = `tts_${action.id}`;
          action.audioId = audioId;
          try {
            const resp = await fetch('/api/generate/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: action.text,
                audioId,
                ttsProviderId: settings.ttsProviderId,
                ttsModelId: ttsProviderConfig?.modelId,
                ttsVoice: settings.ttsVoice,
                ttsSpeed: settings.ttsSpeed,
                ttsApiKey: ttsProviderConfig?.apiKey || undefined,
                ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
              }),
              signal,
            });
            if (!resp.ok) {
              ttsFailCount++;
              continue;
            }
            const ttsData = await resp.json();
            if (!ttsData.success) {
              ttsFailCount++;
              continue;
            }
            const binary = atob(ttsData.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: `audio/${ttsData.format}` });
            await db.audioFiles.put({
              id: audioId,
              blob,
              format: ttsData.format,
              createdAt: Date.now(),
            });
          } catch (err) {
            log.warn(`[TTS] Failed for ${audioId}:`, err);
            ttsFailCount++;
          }
        }

        if (ttsFailCount > 0 && speechActions.length > 0) {
          throw new Error(t('generation.speechFailed'));
        }
      }

      // Add scene to store and navigate
      store.addScene(data.scene);
      store.setCurrentSceneId(data.scene.id);

      // Set remaining outlines as skeleton placeholders
      const remaining = outlines.filter((o) => o.order !== data.scene.order);
      store.setGeneratingOutlines(remaining);

      // Store generation params for classroom to continue generation
      sessionStorage.setItem(
        'generationParams',
        JSON.stringify({
          pdfImages: currentSession.pdfImages,
          agents,
          userProfile,
        }),
      );

      sessionStorage.removeItem('generationSession');
      await store.saveToStorage();
      router.push(`/classroom/${stage.id}`);
    } catch (err) {
      // AbortError is expected when navigating away — don't show as error
      if (err instanceof DOMException && err.name === 'AbortError') {
        log.info('[GenerationPreview] Generation aborted');
        return;
      }
      sessionStorage.removeItem('generationSession');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const extractTopicFromRequirement = (requirement: string): string => {
    const trimmed = requirement.trim();
    if (trimmed.length <= 500) {
      return trimmed;
    }
    return trimmed.substring(0, 500).trim() + '...';
  };

  const goBackToHome = () => {
    abortControllerRef.current?.abort();
    sessionStorage.removeItem('generationSession');
    router.push('/create-class');
  };

  // Still loading session from sessionStorage
  if (!sessionLoaded) {
    return (
      <div className="workspace-panel flex min-h-[52vh] items-center justify-center">
        <div className="space-y-4 text-center text-[rgba(100,79,53,0.8)]">
          <div className="mx-auto size-10 rounded-full border-2 border-[rgba(131,101,61,0.26)] border-t-[rgba(83,61,31,0.92)] animate-spin" />
          <div className="space-y-1">
            <p className="font-serif text-xl text-[rgba(52,39,20,0.96)]">正在准备学习内容</p>
            <p className="text-sm">请稍等，马上进入生成流程。</p>
          </div>
        </div>
      </div>
    );
  }

  // No session found
  if (!session) {
    return (
      <div className="workspace-panel flex min-h-[52vh] items-center justify-center p-4">
        <Card className="w-full max-w-lg rounded-[32px] border-[rgba(133,88,34,0.14)] bg-[linear-gradient(180deg,rgba(255,253,248,0.98)_0%,rgba(247,241,231,0.96)_100%)] p-8 shadow-[0_30px_90px_rgba(74,53,21,0.12)]">
          <div className="space-y-5 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-[rgba(151,118,75,0.16)] bg-[rgba(255,255,255,0.9)]">
              <AlertCircle className="size-7 text-[rgba(112,86,54,0.82)]" />
            </div>
            <div className="space-y-2">
              <h2 className="font-serif text-[30px] font-semibold tracking-tight text-[rgba(45,34,20,0.96)]">
                未找到本次生成记录
              </h2>
              <p className="mx-auto max-w-sm text-sm leading-7 text-[rgba(97,78,53,0.8)]">
                可能已过期或被清理，请返回首页重新开始。
              </p>
            </div>
            <Button
              onClick={() => router.push('/create-class')}
              className="h-12 w-full rounded-2xl bg-[rgba(63,48,28,0.96)] text-white hover:bg-[rgba(50,37,22,0.96)]"
            >
              <ArrowLeft className="size-4 mr-2" />
              回到学习首页
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const activeStep =
    activeSteps.length > 0
      ? activeSteps[Math.min(currentStepIndex, activeSteps.length - 1)]
      : ALL_STEPS[0];

  return (
    <div className="relative text-center">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-5 flex justify-start"
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={goBackToHome}
          className="workspace-secondary-btn rounded-2xl border-[rgba(151,118,75,0.16)] bg-white/82 px-4"
        >
          <ArrowLeft className="size-4 mr-2" />
          {t('generation.backToHome')}
        </Button>
      </motion.div>

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full"
        >
          <Card className="workspace-panel relative min-h-[460px] overflow-hidden rounded-[36px] border-[rgba(133,88,34,0.14)] bg-[linear-gradient(180deg,rgba(255,253,248,0.98)_0%,rgba(247,241,231,0.94)_100%)] p-8 md:p-12 shadow-[0_34px_90px_rgba(74,53,21,0.12)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.9),transparent_72%)]" />

            {/* Progress Dots */}
            <div className="absolute left-0 right-0 top-6 flex justify-center gap-2">
              {activeSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-500',
                    idx < currentStepIndex
                      ? 'w-2 bg-[rgba(130,98,57,0.35)]'
                      : idx === currentStepIndex
                        ? 'w-10 bg-[rgba(72,55,31,0.96)]'
                        : 'w-2 bg-[rgba(151,118,75,0.14)]',
                  )}
                />
              ))}
            </div>

            {/* Central Content */}
            <div className="mt-6 flex w-full flex-1 flex-col items-center justify-center space-y-8">
              <div className="rounded-full border border-[rgba(151,118,75,0.14)] bg-white/74 px-4 py-1.5 text-[11px] uppercase tracking-[0.28em] text-[rgba(118,91,55,0.76)]">
                学习内容准备中 · {Math.min(currentStepIndex + 1, activeSteps.length)}/
                {activeSteps.length}
              </div>

              {/* Icon / Visualizer Container */}
              <div className="relative flex size-52 items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-[rgba(151,118,75,0.12)] bg-[radial-gradient(circle,rgba(255,255,255,0.96)_0%,rgba(247,241,231,0.42)_65%,transparent_100%)]" />
                <div className="absolute inset-[18px] rounded-full border border-[rgba(151,118,75,0.1)] bg-white/58" />
                <AnimatePresence mode="popLayout">
                  {error ? (
                    <motion.div
                      key="error"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="flex size-32 items-center justify-center rounded-full border-2 border-[rgba(179,88,74,0.22)] bg-[rgba(190,89,75,0.08)]"
                    >
                      <AlertCircle className="size-16 text-[rgba(160,69,53,0.92)]" />
                    </motion.div>
                  ) : isComplete ? (
                    <motion.div
                      key="complete"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="flex size-32 items-center justify-center rounded-full border-2 border-[rgba(95,122,82,0.22)] bg-[rgba(95,122,82,0.08)]"
                    >
                      <CheckCircle2 className="size-16 text-[rgba(85,112,72,0.92)]" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key={activeStep.id}
                      initial={{ scale: 0.8, opacity: 0, filter: 'blur(10px)' }}
                      animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                      exit={{ scale: 1.2, opacity: 0, filter: 'blur(10px)' }}
                      transition={{ duration: 0.4 }}
                      className="absolute inset-0 flex items-center justify-center"
                    >
                      <StepVisualizer
                        stepId={activeStep.id}
                        outlines={streamingOutlines}
                        webSearchSources={webSearchSources}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Text Content */}
              <div className="mx-auto max-w-md space-y-3">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={error ? 'error' : isComplete ? 'done' : activeStep.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-2"
                  >
                    <h2 className="font-serif text-[34px] font-semibold tracking-tight text-[rgba(46,34,19,0.96)]">
                      {error
                        ? t('generation.generationFailed')
                        : isComplete
                          ? t('generation.generationComplete')
                          : t(activeStep.title)}
                    </h2>
                    <p className="text-base leading-7 text-[rgba(94,75,50,0.84)]">
                      {error
                        ? error
                        : isComplete
                          ? t('generation.classroomReady')
                          : statusMessage || t(activeStep.description)}
                    </p>
                  </motion.div>
                </AnimatePresence>

                {/* Truncation warning indicator */}
                <AnimatePresence>
                  {truncationWarnings.length > 0 && !error && !isComplete && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 30,
                      }}
                      className="flex justify-center"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.button
                            type="button"
                            animate={{
                              boxShadow: [
                                '0 0 0 0 rgba(251, 191, 36, 0), 0 0 0 0 rgba(251, 191, 36, 0)',
                                '0 0 16px 4px rgba(251, 191, 36, 0.12), 0 0 4px 1px rgba(251, 191, 36, 0.08)',
                                '0 0 0 0 rgba(251, 191, 36, 0), 0 0 0 0 rgba(251, 191, 36, 0)',
                              ],
                            }}
                            transition={{
                              duration: 3,
                              repeat: Infinity,
                              ease: 'easeInOut',
                            }}
                            className="relative size-7 rounded-full flex items-center justify-center cursor-default
                                       bg-gradient-to-br from-[rgba(214,173,102,0.18)] to-[rgba(181,126,68,0.12)]
                                       border border-[rgba(190,145,74,0.28)] hover:border-[rgba(190,145,74,0.42)]
                                       hover:from-[rgba(214,173,102,0.24)] hover:to-[rgba(181,126,68,0.18)]
                                       transition-colors duration-300
                                       focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(190,145,74,0.24)]"
                          >
                            <AlertTriangle
                              className="size-3.5 text-[rgba(158,113,47,0.92)]"
                              strokeWidth={2.5}
                            />
                          </motion.button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6}>
                          <div className="space-y-1 py-0.5">
                            {truncationWarnings.map((w, i) => (
                              <p key={i} className="text-xs leading-relaxed">
                                {w}
                              </p>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Footer Action */}
        <div className="h-16 flex items-center justify-center w-full">
          <AnimatePresence>
            {error ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-xs"
              >
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 w-full rounded-2xl border-[rgba(151,118,75,0.18)] bg-white/86 text-[rgba(88,66,37,0.9)] hover:bg-white"
                  onClick={goBackToHome}
                >
                  {t('generation.goBackAndRetry')}
                </Button>
              </motion.div>
            ) : !isComplete ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 text-sm font-medium uppercase tracking-[0.24em] text-[rgba(106,84,57,0.58)]"
              >
                <Sparkles className="size-3 animate-pulse" />
                AI 正在处理中
                {generatedAgents.length > 0 && !showAgentReveal && (
                  <button
                    onClick={() => setShowAgentReveal(true)}
                    className="ml-2 flex items-center gap-1.5 rounded-full border border-[rgba(151,118,75,0.2)] bg-[rgba(247,240,229,0.9)] px-3 py-1 text-xs font-medium normal-case tracking-normal text-[rgba(92,69,39,0.92)] transition-colors hover:bg-white"
                  >
                    <Bot className="size-3" />
                    {t('generation.viewAgents')}
                  </button>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {/* Agent Reveal Modal */}
      <AgentRevealModal
        agents={generatedAgents}
        open={showAgentReveal}
        onClose={() => setShowAgentReveal(false)}
        onAllRevealed={() => {
          agentRevealResolveRef.current?.();
          agentRevealResolveRef.current = null;
        }}
      />
    </div>
  );
}

export default function GenerationPreviewPage() {
  return (
    <DashboardLayout>
      <Suspense
        fallback={
          <div className="workspace-panel flex min-h-[50vh] items-center justify-center">
            <div className="animate-pulse space-y-4 text-center">
              <div className="mx-auto h-8 w-48 rounded-full bg-[rgba(151,118,75,0.12)]" />
              <div className="mx-auto h-4 w-64 rounded-full bg-[rgba(151,118,75,0.12)]" />
            </div>
          </div>
        }
      >
        <GenerationPreviewContent />
      </Suspense>
    </DashboardLayout>
  );
}
