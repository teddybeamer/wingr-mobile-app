import './global.css';

import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Component, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  AltArrowDown,
  ArrowLeft,
  ArrowRight,
  Bolt,
  CheckCircle,
  ChatRound,
  Copy,
  EmojiFunnyCircle,
  FireMinimalistic,
  Heart,
  Refresh,
  ShieldWarning,
  StarsMinimalistic,
  Waterdrop,
} from '@solar-icons/react-native/Linear';
import type { Icon as SolarIcon } from '@solar-icons/react-native/lib/index';
import Svg, { Defs, Ellipse, FeGaussianBlur, Filter } from 'react-native-svg';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  extractScreenshotConversation,
  generateReplies,
  refineVibeCheck,
} from './lib/wingr-ai';
import {
  needsSpeakerConfirmation,
  rebuildOcrResultWithConfirmedUserSide,
} from './lib/wingr-ocr';
import type {
  OcrResult,
  ParsedConversation,
  ReplyBatch,
  ReplyTone,
  RecommendedReplyTone,
  SuggestedReply,
  ToneOption,
  VibeCheck,
} from './types/wingr';
import { OnboardingFlow } from './onboarding/OnboardingFlow';

const DEBUG_BOOT_PROBE = true;

console.log('[Wingr boot] App module loaded');

const FONTS = {
  display: 'ClashDisplay',
  body: 'ClashGrotesk',
  bodyRegular: 'ClashGroteskRegular',
};

const COLORS = {
  background: '#080808',
  blue: '#1970FD',
  white: '#F6F7FB',
  muted: '#B7B7BE',
  border: '#5B5B64',
  panel: '#101010',
  panelRaised: '#151515',
  green: '#21C57A',
  yellow: '#F6B94B',
  red: '#FF5A65',
  purple: '#6552FF',
  orange: '#D66A00',
  teal: '#00B8AF',
  teal700: '#0F766E',
  teal800: '#115E59',
  indigo700: '#4338CA',
  indigo800: '#3730A3',
};

type Screen = 'onboarding' | 'landing' | 'upload' | 'analyzing' | 'speakerConfirmation' | 'vibecheck' | 'replies';
type MetricVariant = 'interest' | 'energy' | 'risk' | 'move';

type BootErrorBoundaryProps = {
  children: ReactNode;
};

type BootErrorBoundaryState = {
  error: Error | null;
};

class BootErrorBoundary extends Component<BootErrorBoundaryProps, BootErrorBoundaryState> {
  state: BootErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[Wingr boot] Render error boundary caught', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.debugBootScreen}>
          <Text style={styles.debugBootTitle}>Wingr render error</Text>
          <Text style={styles.debugBootBody}>{this.state.error.message}</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const TONE_OPTIONS: ToneOption[] = [
  { value: 'playful', label: 'Playful', icon: EmojiFunnyCircle },
  { value: 'direct', label: 'Direct', icon: FireMinimalistic },
  { value: 'casualSmallTalk', label: 'Small talk', icon: Waterdrop },
];

function getToneLabel(tone: ReplyTone | RecommendedReplyTone) {
  return TONE_OPTIONS.find((option) => option.value === tone)?.label ?? 'Playful';
}

function getUnusedReplies(replyBatch: ReplyBatch, tone: ReplyTone, shownReplyIds: string[]) {
  const shownIds = new Set(shownReplyIds);

  return (replyBatch[tone] ?? []).filter((reply) => !shownIds.has(reply.id));
}

function getVisibleRepliesForTone(replyBatch: ReplyBatch, tone: ReplyTone, shownReplyIds: string[]) {
  return getUnusedReplies(replyBatch, tone, shownReplyIds).slice(0, 2);
}

function mergeReplyBatch(currentBatch: ReplyBatch, nextBatch: ReplyBatch) {
  return {
    ...currentBatch,
    ...nextBatch,
  };
}

function appendShownReplyIds(currentShownReplyIds: string[], replies: SuggestedReply[]) {
  return [
    ...currentShownReplyIds,
    ...replies.map((reply) => reply.id).filter((replyId) => !currentShownReplyIds.includes(replyId)),
  ];
}

function getConversationEnergyCopy(vibeCheck: VibeCheck) {
  const rawEnergy = vibeCheck.conversationEnergy.trim();
  const lowerEnergy = rawEnergy.toLowerCase();
  const debugTerms = ['detected', 'speaker', 'ocr', 'confidence', 'parsed'];
  const looksLikeInternalOutput = debugTerms.some((term) => lowerEnergy.includes(term));
  const hasSituationLanguage =
    rawEnergy.length >= 55 &&
    /\b(they|their|chat|conversation|reply|message|interest|momentum|move|room)\b/i.test(rawEnergy);

  if (hasSituationLanguage && !looksLikeInternalOutput) {
    return rawEnergy;
  }

  if (lowerEnergy.includes('dry') || lowerEnergy.includes('short') || lowerEnergy.includes('low')) {
    return "They're keeping it short, but there's still room to play.";
  }

  if (lowerEnergy.includes('playful') || lowerEnergy.includes('light')) {
    return 'The conversation is light and playful, but it needs a more confident next move.';
  }

  if (lowerEnergy.includes('high') || lowerEnergy.includes('warm')) {
    return 'There is good energy here, so keep momentum with a clear next move.';
  }

  if (vibeCheck.interestLevel === 'Unclear') {
    return 'There is some signal here, but the next reply should make the vibe easier to read.';
  }

  return "There's some interest here, but the chat needs a sharper reply to keep momentum.";
}

const METRIC_VARIANTS: Record<
  MetricVariant,
  {
    backgroundColor: string;
    blobColors: [string, string, string];
    iconColor: string;
    valueColor: string;
  }
> = {
  interest: {
    backgroundColor: '#4F46E5',
    blobColors: ['rgba(55, 48, 163, 0.88)', 'rgba(67, 56, 202, 0.62)', 'rgba(55, 48, 163, 0.42)'],
    iconColor: '#C7D2FE',
    valueColor: '#6D5CFF',
  },
  energy: {
    backgroundColor: '#D97706',
    blobColors: ['rgba(146, 64, 14, 0.88)', 'rgba(180, 83, 9, 0.62)', 'rgba(146, 64, 14, 0.42)'],
    iconColor: '#FDE68A',
    valueColor: '#F6B94B',
  },
  risk: {
    backgroundColor: '#DC2626',
    blobColors: ['rgba(153, 27, 27, 0.88)', 'rgba(185, 28, 28, 0.62)', 'rgba(153, 27, 27, 0.42)'],
    iconColor: '#FECACA',
    valueColor: '#FF4D5E',
  },
  move: {
    backgroundColor: '#0D9488',
    blobColors: ['rgba(17, 94, 89, 0.88)', 'rgba(15, 118, 110, 0.62)', 'rgba(17, 94, 89, 0.42)'],
    iconColor: '#99F6E4',
    valueColor: '#00C2B8',
  },
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [showDebugBootScreen, setShowDebugBootScreen] = useState(DEBUG_BOOT_PROBE);
  const [selectedScreenshotUri, setSelectedScreenshotUri] = useState<string | null>(null);
  const [chatTranscript, setChatTranscript] = useState('');
  const [extraContext, setExtraContext] = useState('');
  const [replyContext, setReplyContext] = useState('');
  const [selectedTone, setSelectedTone] = useState<ReplyTone>('playful');
  const [replyBatch, setReplyBatch] = useState<ReplyBatch>({});
  const [visibleReplies, setVisibleReplies] = useState<SuggestedReply[]>([]);
  const [shownReplyIds, setShownReplyIds] = useState<string[]>([]);
  const [vibeCheck, setVibeCheck] = useState<VibeCheck | null>(null);
  const [parsedConversation, setParsedConversation] = useState<ParsedConversation | null>(null);
  const [pendingSpeakerOcr, setPendingSpeakerOcr] = useState<OcrResult | null>(null);
  const [pendingSpeakerContext, setPendingSpeakerContext] = useState('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isGeneratingReplies, setIsGeneratingReplies] = useState(false);
  const analysisRequestIdRef = useRef(0);
  const [fontsLoaded] = useFonts({
    [FONTS.display]: require('./assets/fonts/ClashDisplay-Variable.ttf'),
    [FONTS.body]: require('./assets/fonts/ClashGrotesk-Variable.ttf'),
    [FONTS.bodyRegular]: require('./assets/fonts/ClashGrotesk-Regular.ttf'),
  });

  console.log('[Wingr boot] App render', {
    fontsLoaded,
    screen,
    showDebugBootScreen,
  });

  useEffect(() => {
    console.log('[Wingr boot] App mounted');

    if (!DEBUG_BOOT_PROBE) {
      return;
    }

    const timeoutId = setTimeout(() => {
      console.log('[Wingr boot] Hiding debug boot screen');
      setShowDebugBootScreen(false);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    console.log('[Wingr boot] Fonts loaded state changed', fontsLoaded);
  }, [fontsLoaded]);

  const generateRepliesForTone = async ({
    tone,
    nextContext,
    nextScreenshotUri = selectedScreenshotUri,
    nextParsedConversation = parsedConversation,
    nextTranscriptText = chatTranscript,
    nextVibeCheck = vibeCheck,
  }: {
    tone: ReplyTone;
    nextContext: string;
    nextScreenshotUri?: string | null;
    nextParsedConversation?: ParsedConversation | null;
    nextTranscriptText?: string;
    nextVibeCheck?: VibeCheck | null;
  }) => {
    if (!nextVibeCheck || !nextTranscriptText) {
      throw new Error('Vibe check is not ready yet.');
    }

    return generateReplies({
      vibeCheck: nextVibeCheck,
      selectedTone: tone,
      screenshotUri: nextScreenshotUri ?? null,
      parsedConversation: nextParsedConversation ?? undefined,
      transcriptText: nextTranscriptText,
      extraContext: nextContext,
    });
  };

  if (showDebugBootScreen) {
    return (
      <View style={styles.debugBootScreen}>
        <Text style={styles.debugBootTitle}>Wingr loaded</Text>
        <Text style={styles.debugBootBody}>JS mounted. Waiting for app render...</Text>
      </View>
    );
  }

  if (!fontsLoaded) {
    console.log('[Wingr boot] Waiting for fonts');
    return (
      <View style={styles.debugBootScreen}>
        <Text style={styles.debugBootTitle}>Wingr loaded</Text>
        <Text style={styles.debugBootBody}>Loading fonts...</Text>
      </View>
    );
  }

  const applyConversationResult = (ocr: OcrResult, nextVibeCheck: VibeCheck) => {
    setChatTranscript(ocr.transcriptText);
    setParsedConversation(ocr.parsedConversation);
    setReplyBatch({});
    setVisibleReplies([]);
    setShownReplyIds([]);
    setSelectedTone(nextVibeCheck.bestTone);
    setVibeCheck(nextVibeCheck);
  };

  const getCompletedVibeCheck = async ({
    nextExtraContext,
    parsedConversation: nextParsedConversation,
    transcriptText,
  }: {
    nextExtraContext: string;
    parsedConversation: ParsedConversation;
    transcriptText: string;
  }) => {
    const completedVibeCheck = await refineVibeCheck({
      extraContext: nextExtraContext || undefined,
      parsedConversation: nextParsedConversation,
      transcriptText,
    });

    console.info('[Wingr timing] vibe-check-result', {
      result: 'completed',
    });

    return completedVibeCheck;
  };

  const getReplyVibeCheck = async () => {
    if (vibeCheck) {
      return vibeCheck;
    }

    throw new Error('Vibe check is not ready yet.');
  };

  const handleAnalyzeScreenshot = async (screenshotUri: string, nextExtraContext = '') => {
    const requestId = analysisRequestIdRef.current + 1;
    const trimmedContext = nextExtraContext.trim();

    analysisRequestIdRef.current = requestId;
    setExtraContext(nextExtraContext);
    setAnalysisError(null);
    setChatTranscript('');
    setParsedConversation(null);
    setPendingSpeakerOcr(null);
    setPendingSpeakerContext('');
    setVibeCheck(null);
    setReplyBatch({});
    setVisibleReplies([]);
    setShownReplyIds([]);
    setReplyContext(trimmedContext);
    setIsGeneratingReplies(false);
    setScreen('analyzing');

    try {
      const ocr = await extractScreenshotConversation(screenshotUri);

      if (analysisRequestIdRef.current !== requestId) {
        return;
      }

      setChatTranscript(ocr.transcriptText);

      if (needsSpeakerConfirmation(ocr.parsedConversation)) {
        setPendingSpeakerOcr(ocr);
        setPendingSpeakerContext(nextExtraContext);
        setScreen('speakerConfirmation');
        return;
      }

      const completedVibeCheck = await getCompletedVibeCheck({
        nextExtraContext,
        parsedConversation: ocr.parsedConversation,
        transcriptText: ocr.transcriptText,
      });

      if (analysisRequestIdRef.current !== requestId) {
        return;
      }

      applyConversationResult(ocr, completedVibeCheck);
      setScreen('vibecheck');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Wingr could not read that screenshot. Try another image.';

      setAnalysisError(message);
      Alert.alert('Could not read screenshot', 'Try another screenshot or upload again.');
      setScreen('upload');
    }
  };

  const handleConfirmSpeakerSide = async (userSide: 'left' | 'right') => {
    if (!pendingSpeakerOcr) {
      setScreen('upload');
      return;
    }

    const requestId = analysisRequestIdRef.current + 1;
    const confirmedOcr = rebuildOcrResultWithConfirmedUserSide(pendingSpeakerOcr, userSide);

    analysisRequestIdRef.current = requestId;
    setScreen('analyzing');
    setPendingSpeakerOcr(null);
    setChatTranscript(confirmedOcr.transcriptText);

    try {
      const completedVibeCheck = await getCompletedVibeCheck({
        nextExtraContext: pendingSpeakerContext,
        parsedConversation: confirmedOcr.parsedConversation,
        transcriptText: confirmedOcr.transcriptText,
      });

      if (analysisRequestIdRef.current !== requestId) {
        return;
      }

      applyConversationResult(confirmedOcr, completedVibeCheck);
      setPendingSpeakerContext('');
      setScreen('vibecheck');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Wingr could not read that screenshot. Try another image.';

      setAnalysisError(message);
      Alert.alert('Could not read screenshot', 'Try another screenshot or upload again.');
      setScreen('upload');
    }
  };

  const handleCancelSpeakerConfirmation = () => {
    setPendingSpeakerOcr(null);
    setPendingSpeakerContext('');
    setScreen('upload');
  };

  const pickScreenshot = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Wingr needs access to your photos so you can upload a text screenshot.',
      );
      return;
    }

    return ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });
  };

  const handlePickScreenshotForUpload = async () => {
    const result = await pickScreenshot();

    if (!result || result.canceled) {
      return;
    }

    const screenshotUri = result.assets[0].uri;

    setSelectedScreenshotUri(screenshotUri);
    setAnalysisError(null);
    setScreen('upload');
  };

  const handleCheckSelectedScreenshot = async () => {
    if (!selectedScreenshotUri) {
      await handlePickScreenshotForUpload();
      return;
    }

    await handleAnalyzeScreenshot(selectedScreenshotUri);
  };

  const handleGenerateReplies = async () => {
    if (!vibeCheck) {
      Alert.alert('Vibe check needed', 'Upload a screenshot so Wingr can read the vibe first.');
      return;
    }

    const nextContext = extraContext.trim();
    const cachedReplies = getVisibleRepliesForTone(replyBatch, selectedTone, shownReplyIds);

    setReplyContext(nextContext);
    setScreen('replies');

    if (cachedReplies.length === 2) {
      setVisibleReplies(cachedReplies);
      setShownReplyIds((currentShownReplyIds) => appendShownReplyIds(currentShownReplyIds, cachedReplies));
      return;
    }

    setIsGeneratingReplies(true);
    setVisibleReplies([]);

    try {
      const replyVibeCheck = await getReplyVibeCheck();
      const nextReplyBatch = await generateRepliesForTone({
        tone: selectedTone,
        nextContext,
        nextVibeCheck: replyVibeCheck,
      });
      const nextVisibleReplies = (nextReplyBatch[selectedTone] ?? []).slice(0, 2);

      setReplyBatch((currentReplyBatch) => mergeReplyBatch(currentReplyBatch, nextReplyBatch));
      setVisibleReplies(nextVisibleReplies);
      setShownReplyIds((currentShownReplyIds) =>
        appendShownReplyIds(currentShownReplyIds, nextVisibleReplies),
      );
    } catch {
      Alert.alert('Could not generate replies', 'Try again in a moment.');
      setScreen('vibecheck');
    } finally {
      setIsGeneratingReplies(false);
    }
  };

  const handleToneChange = async (tone: ReplyTone) => {
    setSelectedTone(tone);
    const cachedReplies = getVisibleRepliesForTone(replyBatch, tone, shownReplyIds);

    if (cachedReplies.length === 2) {
      setVisibleReplies(cachedReplies);
      setShownReplyIds((currentShownReplyIds) => appendShownReplyIds(currentShownReplyIds, cachedReplies));
      return;
    }

    setIsGeneratingReplies(true);

    try {
      const nextReplyBatch = await generateRepliesForTone({
        tone,
        nextContext: replyContext,
      });
      const nextVisibleReplies = (nextReplyBatch[tone] ?? []).slice(0, 2);

      setReplyBatch((currentReplyBatch) => mergeReplyBatch(currentReplyBatch, nextReplyBatch));
      setVisibleReplies(nextVisibleReplies);
      setShownReplyIds((currentShownReplyIds) =>
        appendShownReplyIds(currentShownReplyIds, nextVisibleReplies),
      );
    } catch (error) {
      throw error;
    } finally {
      setIsGeneratingReplies(false);
    }
  };

  const handleRefreshReplies = async () => {
    const cachedReplies = getVisibleRepliesForTone(replyBatch, selectedTone, shownReplyIds);

    if (cachedReplies.length === 2) {
      setVisibleReplies(cachedReplies);
      setShownReplyIds((currentShownReplyIds) => appendShownReplyIds(currentShownReplyIds, cachedReplies));
      return;
    }

    setIsGeneratingReplies(true);

    try {
      const nextReplyBatch = await generateRepliesForTone({
        tone: selectedTone,
        nextContext: replyContext,
      });
      const nextVisibleReplies = (nextReplyBatch[selectedTone] ?? []).slice(0, 2);

      setReplyBatch((currentReplyBatch) => mergeReplyBatch(currentReplyBatch, nextReplyBatch));
      setVisibleReplies(nextVisibleReplies);
      setShownReplyIds((currentShownReplyIds) =>
        appendShownReplyIds(currentShownReplyIds, nextVisibleReplies),
      );
    } catch (error) {
      throw error;
    } finally {
      setIsGeneratingReplies(false);
    }
  };

  return (
    <BootErrorBoundary>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        {screen === 'onboarding' ? (
          <OnboardingFlow onComplete={() => setScreen('landing')} />
        ) : null}

      {screen === 'landing' ? (
        <LandingScreen onContinue={handlePickScreenshotForUpload} />
      ) : null}

      {screen === 'upload' ? (
        <UploadScreenshotScreen
          onBack={() => setScreen('landing')}
          onChangeScreenshot={handlePickScreenshotForUpload}
          onCheckVibe={handleCheckSelectedScreenshot}
          selectedScreenshotUri={selectedScreenshotUri}
        />
      ) : null}

      {screen === 'analyzing' ? (
        <AnalyzingScreen selectedScreenshotUri={selectedScreenshotUri} />
      ) : null}

      {screen === 'speakerConfirmation' ? (
        <SpeakerConfirmationScreen
          onBack={handleCancelSpeakerConfirmation}
          onConfirm={handleConfirmSpeakerSide}
          selectedScreenshotUri={selectedScreenshotUri}
        />
      ) : null}

      {screen === 'vibecheck' && vibeCheck ? (
        <VibeCheckScreen
          onBack={() => setScreen('upload')}
          isGeneratingReplies={isGeneratingReplies}
          onGenerateReplies={handleGenerateReplies}
          vibeCheck={vibeCheck}
        />
      ) : null}

      {screen === 'replies' && vibeCheck ? (
        <RepliesScreen
          isGeneratingReplies={isGeneratingReplies}
          onBack={() => setScreen('vibecheck')}
          onRefreshReplies={handleRefreshReplies}
          onToneChange={handleToneChange}
          replies={visibleReplies}
          selectedTone={selectedTone}
        />
      ) : null}

      </SafeAreaView>
    </BootErrorBoundary>
  );
}

function LandingScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <View className="flex-1 bg-[#080808] px-4 pt-4">
      <View className="items-center">
        <Text className="font-display text-[18px] font-bold leading-[22px] text-[#2563EB]">
          Wingr
        </Text>
      </View>

      <View className="mt-9 items-center">
        <View className="w-full max-w-[360px] overflow-hidden rounded-[20px] bg-[#111111]">
          <View className="w-full aspect-[328/426] overflow-hidden bg-[#0d0d0d]">
            <Image
              accessibilityIgnoresInvertColors
              className="h-full w-full"
              resizeMode="cover"
              source={require('./assets/images/landing-screen-image.png')}
            />
          </View>

          <View className="gap-3 bg-[#171717] px-5 py-5">
            <Text className="font-display text-landing-heading font-bold text-white">
              Get better replies
            </Text>

            <Text className="font-bodyRegular text-landing-body text-[#A1A1AA]" numberOfLines={2}>
              Check the energy, interest, and best move before you reply.
            </Text>

            <Pressable
              accessibilityLabel="Upload screenshot"
              accessibilityRole="button"
              className="mt-1 h-12 w-full flex-row items-center justify-center gap-2 rounded-full bg-blue-700 shadow-lg shadow-black/60"
              onPress={onContinue}
            >
              <Text className="font-body text-landing-cta font-semibold text-white">
                Upload screenshot
              </Text>
              <ArrowRight color="#FFFFFF" size={16} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function UploadScreenshotScreen({
  onBack,
  onChangeScreenshot,
  onCheckVibe,
  selectedScreenshotUri,
}: {
  onBack: () => void;
  onChangeScreenshot: () => void;
  onCheckVibe: () => void;
  selectedScreenshotUri: string | null;
}) {
  return (
    <View className="flex-1 bg-[#080808] px-4 pt-4">
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          className="h-10 w-10 items-center justify-center rounded-full bg-white/[0.10]"
          onPress={onBack}
        >
          <ArrowLeft color="#FFFFFF" size={20} />
        </Pressable>

        <Text className="font-display text-[18px] font-bold leading-[22px] text-blue-700">
          Upload Screenshot
        </Text>

        <View className="h-10 w-10" />
      </View>

      <View className="mt-9 items-center">
        <View className="w-full max-w-[360px] rounded-[20px] bg-[#171717] px-5 py-5">
          <View className="items-center">
            <Pressable
              accessibilityLabel="Change Screenshot"
              accessibilityRole="button"
              className="h-10 flex-row items-center justify-center gap-2 rounded-full border border-white/55 px-5"
              onPress={onChangeScreenshot}
            >
              <Refresh color="#FFFFFF" size={17} />
              <Text className="font-body text-[14px] font-semibold leading-[18px] text-white">
                Change Screenshot
              </Text>
            </Pressable>
          </View>

          <View className="mt-5 aspect-[288/332] w-full overflow-hidden rounded-[20px] bg-[#101010]">
            {selectedScreenshotUri ? (
              <Image
                accessibilityIgnoresInvertColors
                className="h-full w-full"
                resizeMode="cover"
                source={{ uri: selectedScreenshotUri }}
              />
            ) : (
              <View className="h-full w-full items-center justify-center bg-[#101010] px-6">
                <Text className="text-center font-bodyRegular text-[15px] leading-[20px] text-[#A1A1AA]">
                  No screenshot selected
                </Text>
              </View>
            )}
          </View>

          <View className="pt-5">
            <Pressable
              accessibilityLabel="Check the vibe"
              accessibilityRole="button"
              className="h-12 w-full flex-row items-center justify-center gap-3 rounded-full bg-blue-700 shadow-lg shadow-black/60"
              onPress={onCheckVibe}
            >
              <Text className="font-body text-landing-cta font-semibold text-white">
                Check the vibe
              </Text>
              <ArrowRight color="#FFFFFF" size={18} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function AnalyzingScreen({ selectedScreenshotUri }: { selectedScreenshotUri: string | null }) {
  return (
    <View style={[styles.screen, styles.analyzingScreen]}>
      <Text style={styles.vibeHeaderTitle}>Reading chat</Text>
      {selectedScreenshotUri ? (
        <Image resizeMode="cover" source={{ uri: selectedScreenshotUri }} style={styles.analyzingImage} />
      ) : null}
      <ActivityIndicator color={COLORS.blue} size="large" />
      <Text style={styles.analyzingTitle}>Extracting the conversation...</Text>
      <Text style={styles.analyzingText}>
        Wingr is reading the screenshot and checking the vibe.
      </Text>
    </View>
  );
}

function SpeakerConfirmationScreen({
  onBack,
  onConfirm,
  selectedScreenshotUri,
}: {
  onBack: () => void;
  onConfirm: (userSide: 'left' | 'right') => void;
  selectedScreenshotUri: string | null;
}) {
  return (
    <View style={[styles.screen, styles.speakerConfirmationScreen]}>
      <View style={styles.vibeHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back to upload"
          hitSlop={12}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.uploadButtonPressed]}
        >
          <ArrowLeft color={COLORS.white} size={22} />
        </Pressable>
        <Text style={styles.vibeHeaderTitle}>Quick check</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.speakerConfirmationBody}>
        {selectedScreenshotUri ? (
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            source={{ uri: selectedScreenshotUri }}
            style={styles.speakerConfirmationImage}
          />
        ) : null}

        <View style={styles.speakerConfirmationCard}>
          <Text style={styles.speakerConfirmationTitle}>Just checking — which side is you?</Text>
          <Text style={styles.speakerConfirmationText}>
            Wingr needs this once so it does not write replies to your own message.
          </Text>

          <View style={styles.speakerConfirmationButtons}>
            <TouchableOpacity
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Right side is me"
              onPress={() => onConfirm('right')}
              style={styles.speakerConfirmationButton}
            >
              <Text style={styles.speakerConfirmationButtonText}>Right side</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Left side is me"
              onPress={() => onConfirm('left')}
              style={[styles.speakerConfirmationButton, styles.speakerConfirmationSecondaryButton]}
            >
              <Text style={styles.speakerConfirmationButtonText}>Left side</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

function VibeCheckScreen({
  isGeneratingReplies,
  onBack,
  onGenerateReplies,
  vibeCheck,
}: {
  isGeneratingReplies: boolean;
  onBack: () => void;
  onGenerateReplies: () => void;
  vibeCheck: VibeCheck;
}) {
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboardScreen}
    >
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.vibeScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={styles.screen}
      >
        <View style={styles.vibeHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back to upload"
            hitSlop={12}
            onPress={onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.uploadButtonPressed]}
          >
            <ArrowLeft color={COLORS.white} size={22} />
          </Pressable>
          <Text style={styles.vibeHeaderTitle}>Vibe Check</Text>
          <View style={styles.backButton} />
        </View>

        <View style={styles.vibeCard}>
          <View style={styles.vibeCardTitleRow}>
            <Text style={styles.vibeCardTitle}>Vibe check</Text>
          </View>
          <Text style={styles.vibeSummaryText}>{vibeCheck.summary}</Text>
          <VibeMetric
            icon={Heart}
            label="Their interest"
            value={vibeCheck.interestLevel}
            variant="interest"
            withMeter
          />
          <VibeMetric
            icon={Bolt}
            label="Conversation energy"
            value={getConversationEnergyCopy(vibeCheck)}
            variant="energy"
          />
          <VibeMetric
            icon={ChatRound}
            label="Best tone"
            value={getToneLabel(vibeCheck.bestTone)}
            variant="move"
          />
          <VibeMetric
            icon={ShieldWarning}
            label="Risk"
            value={vibeCheck.risk}
            isLast
            variant="risk"
          />
        </View>

        <TouchableOpacity
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel="Get replies"
          disabled={isGeneratingReplies}
          onPress={onGenerateReplies}
          style={[
            styles.generateButton,
            isGeneratingReplies && styles.disabledButton,
          ]}
        >
          {isGeneratingReplies ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Text style={styles.generateButtonText}>Get replies</Text>
              <ArrowRight color={COLORS.white} size={22} />
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function VibeMetric({
  icon,
  label,
  value,
  variant,
  isLast,
  withMeter,
}: {
  icon: SolarIcon;
  label: string;
  value: string;
  variant: MetricVariant;
  isLast?: boolean;
  withMeter?: boolean;
}) {
  const config = METRIC_VARIANTS[variant];

  return (
    <View style={[styles.metricRow, isLast && styles.metricRowLast]}>
      <GlowIconContainer Icon={icon} variant={variant} />
      <View style={styles.metricCopy}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text
          style={[
            styles.metricValue,
            variant === 'energy' && styles.metricValueBody,
            { color: config.valueColor },
          ]}
        >
          {value}
        </Text>
      </View>
      {withMeter ? (
        <View style={styles.meterTrack}>
          <View style={styles.meterFill} />
        </View>
      ) : null}
    </View>
  );
}

function GlowIconContainer({
  Icon,
  variant,
}: {
  Icon: SolarIcon;
  variant: MetricVariant;
}) {
  const config = METRIC_VARIANTS[variant];

  return (
    <View style={[styles.glowIconContainer, { backgroundColor: config.backgroundColor }]}>
      <Svg
        height="34"
        pointerEvents="none"
        style={styles.glowSvg}
        viewBox="0 0 34 34"
        width="34"
      >
        <Defs>
          <Filter height="280%" id="blobBlurTopLeft" width="280%" x="-90%" y="-90%">
            <FeGaussianBlur stdDeviation="14" />
          </Filter>
          <Filter height="280%" id="blobBlurTopRight" width="280%" x="-90%" y="-90%">
            <FeGaussianBlur stdDeviation="14" />
          </Filter>
          <Filter height="280%" id="blobBlurBottom" width="280%" x="-90%" y="-90%">
            <FeGaussianBlur stdDeviation="16" />
          </Filter>
        </Defs>
        <Ellipse
          cx="2"
          cy="7"
          fill={config.blobColors[0]}
          filter="url(#blobBlurTopLeft)"
          rx="20"
          ry="8"
          transform="rotate(-16 2 7)"
        />
        <Ellipse
          cx="31"
          cy="10"
          fill={config.blobColors[1]}
          filter="url(#blobBlurTopRight)"
          rx="20"
          ry="8"
          transform="rotate(18 31 10)"
        />
        <Ellipse
          cx="15"
          cy="33"
          fill={config.blobColors[2]}
          filter="url(#blobBlurBottom)"
          rx="20"
          ry="8"
          transform="rotate(-10 15 33)"
        />
      </Svg>
      <View style={styles.metricIconForeground}>
        <Icon color={config.iconColor} size={20} />
      </View>
    </View>
  );
}

function RepliesScreen({
  isGeneratingReplies,
  onBack,
  onRefreshReplies,
  onToneChange,
  replies,
  selectedTone,
}: {
  isGeneratingReplies: boolean;
  onBack: () => void;
  onRefreshReplies: () => Promise<void>;
  onToneChange: (tone: ReplyTone) => Promise<void>;
  replies: SuggestedReply[];
  selectedTone: ReplyTone;
}) {
  const [isToneSheetOpen, setIsToneSheetOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedReplyId, setCopiedReplyId] = useState<string | null>(null);
  const selectedToneLabel = getToneLabel(selectedTone);

  const handleCopyReply = async (reply: SuggestedReply) => {
    const didCopy = await Clipboard.setStringAsync(reply.text);

    if (didCopy) {
      setCopiedReplyId(reply.id);
    }
  };

  const handleRegenerateReplies = async () => {
    setIsRefreshing(true);

    try {
      await onRefreshReplies();
      setCopiedReplyId(null);
    } catch {
      Alert.alert('Could not refresh replies', 'Try again in a moment.');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <View style={[styles.screen, styles.repliesScreen]}>
      <View style={styles.vibeHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back to Vibe Check"
          hitSlop={12}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.uploadButtonPressed]}
        >
          <ArrowLeft color={COLORS.white} size={22} />
        </Pressable>
        <Text style={styles.vibeHeaderTitle}>Replies</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        bounces={false}
        contentContainerStyle={styles.repliesScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.repliesControlsRow}>
          <TouchableOpacity
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Get new replies"
            disabled={isRefreshing || isGeneratingReplies}
            onPress={handleRegenerateReplies}
            style={[
              styles.newRepliesButton,
              (isRefreshing || isGeneratingReplies) && styles.disabledButton,
            ]}
          >
            {isRefreshing || isGeneratingReplies ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Refresh color={COLORS.white} size={16} />
                <Text style={styles.newRepliesButtonText}>New Replies</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Change reply tone"
            onPress={() => setIsToneSheetOpen(true)}
            style={styles.toneSelector}
          >
            <StarsMinimalistic color="#D6D6DB" size={14} />
            <Text numberOfLines={1} style={styles.toneSelectorText}>
              {selectedToneLabel}
            </Text>
            <AltArrowDown color="#D6D6DB" size={16} />
          </TouchableOpacity>
        </View>

        <View style={styles.replyCards}>
          {replies.length === 0 && isGeneratingReplies ? (
            <View style={styles.repliesLoadingCard}>
              <ActivityIndicator color={COLORS.blue} />
              <Text style={styles.repliesLoadingText}>Writing replies...</Text>
            </View>
          ) : null}

          {replies.slice(0, 2).map((reply, index) => (
            <ReplyCard
              copied={copiedReplyId === reply.id}
              key={reply.id}
              onCopy={() => handleCopyReply(reply)}
              recommended={index === 0}
              reply={reply}
            />
          ))}
        </View>
      </ScrollView>

      <ToneBottomSheet
        onClose={() => setIsToneSheetOpen(false)}
        onSelect={async (tone) => {
          setIsToneSheetOpen(false);
          setIsRefreshing(true);

          try {
            await onToneChange(tone);
            setCopiedReplyId(null);
          } catch {
            Alert.alert('Could not refresh replies', 'Try again in a moment.');
          } finally {
            setIsRefreshing(false);
          }
        }}
        selectedTone={selectedTone}
        visible={isToneSheetOpen}
      />
    </View>
  );
}

function ReplyCard({
  copied,
  onCopy,
  recommended,
  reply,
}: {
  copied: boolean;
  onCopy: () => void;
  recommended: boolean;
  reply: SuggestedReply;
}) {
  return (
    <View style={[styles.replyCard, recommended && styles.recommendedReplyCard]}>
      {recommended ? (
        <View style={styles.recommendedBadge}>
          <StarsMinimalistic color="#4D8CFF" size={14} />
          <Text style={styles.recommendedBadgeText}>Recommended</Text>
        </View>
      ) : null}

      <View style={[styles.replyCardBody, !recommended && styles.replyCardBodySecondary]}>
        <Text style={styles.replyText}>{reply.text}</Text>

        {recommended && reply.whyItWorks ? (
          <View style={styles.whyItWorks}>
            <Text style={styles.whyItWorksTitle}>Why it works:</Text>
            <Text style={styles.whyItWorksText}>{reply.whyItWorks}</Text>
          </View>
        ) : null}
      </View>

      <TouchableOpacity
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel="Copy reply"
        onPress={onCopy}
        style={styles.copyButton}
      >
        {copied ? (
          <CheckCircle color={COLORS.white} size={16} />
        ) : (
          <Copy color={COLORS.white} size={16} />
        )}
        <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ToneBottomSheet({
  onClose,
  onSelect,
  selectedTone,
  visible,
}: {
  onClose: () => void;
  onSelect: (tone: ReplyTone) => void;
  selectedTone: ReplyTone;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetPanel}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Choose tone</Text>
          <View style={styles.toneOptions}>
            {TONE_OPTIONS.map((option) => {
              const selected = option.value === selectedTone;
              const ToneIcon = option.icon;

              return (
                <TouchableOpacity
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={option.value}
                  onPress={() => onSelect(option.value)}
                  style={[
                    styles.toneOption,
                    selected && styles.toneOptionSelected,
                  ]}
                >
                  <View style={styles.toneOptionLeft}>
                    <ToneIcon color={selected ? COLORS.blue : '#D6D6DB'} size={20} />
                    <Text
                      numberOfLines={1}
                      style={[styles.toneOptionText, selected && styles.toneOptionTextSelected]}
                    >
                      {option.label}
                    </Text>
                  </View>
                  <View style={styles.toneOptionCheckSlot}>
                    {selected ? <CheckCircle color={COLORS.blue} size={21} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  debugBootBody: {
    color: '#B7B7BE',
    fontSize: 16,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
  debugBootScreen: {
    alignItems: 'center',
    backgroundColor: '#080808',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  debugBootTitle: {
    color: '#F6F7FB',
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 34,
    textAlign: 'center',
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  logo: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    textAlign: 'center',
  },
  heroImage: {
    alignSelf: 'center',
    height: 405,
    marginTop: 36,
    width: '100%',
  },
  uploadSection: {
    gap: 14,
    marginTop: 14,
  },
  sectionTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 27,
    fontWeight: '700',
    lineHeight: 33,
  },
  errorText: {
    color: COLORS.red,
    fontFamily: FONTS.bodyRegular,
    fontSize: 14,
    lineHeight: 19,
  },
  uploadButton: {
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderColor: COLORS.border,
    borderRadius: 18,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 160,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  uploadButtonPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  uploadEmptyState: {
    alignItems: 'center',
    gap: 16,
    justifyContent: 'center',
  },
  uploadText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    textAlign: 'center',
  },
  uploadSubtext: {
    color: COLORS.muted,
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 20,
    marginTop: 2,
    textAlign: 'center',
  },
  plusButton: {
    alignItems: 'center',
    borderColor: COLORS.white,
    borderRadius: 7,
    borderWidth: 1,
    height: 21,
    justifyContent: 'center',
    width: 21,
  },
  plusText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: '500',
    lineHeight: 20,
  },
  selectedPreview: {
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  selectedImage: {
    opacity: 0.44,
  },
  selectedOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    flex: 1,
    justifyContent: 'center',
  },
  analyzingScreen: {
    alignItems: 'center',
    gap: 18,
    justifyContent: 'center',
    paddingBottom: 48,
  },
  analyzingImage: {
    backgroundColor: '#24242A',
    borderRadius: 20,
    height: 260,
    opacity: 0.68,
    width: 180,
  },
  analyzingTitle: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    textAlign: 'center',
  },
  analyzingText: {
    color: COLORS.muted,
    fontFamily: FONTS.bodyRegular,
    fontSize: 16,
    lineHeight: 22,
    maxWidth: 280,
    textAlign: 'center',
  },
  speakerConfirmationScreen: {
    paddingHorizontal: 16,
  },
  speakerConfirmationBody: {
    alignItems: 'center',
    gap: 18,
    paddingTop: 28,
  },
  speakerConfirmationImage: {
    backgroundColor: '#24242A',
    borderRadius: 20,
    height: 300,
    opacity: 0.72,
    width: 210,
  },
  speakerConfirmationCard: {
    backgroundColor: COLORS.panelRaised,
    borderColor: '#2B2B2F',
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    width: '100%',
  },
  speakerConfirmationTitle: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    textAlign: 'center',
  },
  speakerConfirmationText: {
    color: COLORS.muted,
    fontFamily: FONTS.bodyRegular,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  speakerConfirmationButtons: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 4,
  },
  speakerConfirmationButton: {
    alignItems: 'center',
    backgroundColor: COLORS.blue,
    borderRadius: 999,
    flex: 1,
    height: 48,
    justifyContent: 'center',
  },
  speakerConfirmationSecondaryButton: {
    backgroundColor: '#454545',
  },
  speakerConfirmationButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  keyboardScreen: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  vibeScrollContent: {
    gap: 20,
    paddingBottom: 28,
  },
  vibeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  vibeHeaderTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    textAlign: 'center',
  },
  vibeCard: {
    backgroundColor: COLORS.panelRaised,
    borderRadius: 12,
    gap: 0,
    padding: 10,
  },
  vibeCardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  vibeCardTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
  },
  vibeSummaryText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 21,
    marginBottom: 6,
  },
  metricRow: {
    alignItems: 'center',
    borderBottomColor: '#29292E',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 67,
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  metricRowLast: {
    borderBottomWidth: 0,
  },
  glowIconContainer: {
    backgroundColor: '#062F2C',
    borderRadius: 10,
    height: 34,
    overflow: 'hidden',
    position: 'relative',
    width: 34,
  },
  glowSvg: {
    height: 34,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 34,
  },
  metricIconForeground: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
    zIndex: 2,
  },
  metricCopy: {
    flex: 1,
  },
  metricLabel: {
    color: '#C9C9CF',
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 17,
  },
  metricValue: {
    fontFamily: FONTS.display,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  metricValueBody: {
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
  },
  meterTrack: {
    backgroundColor: '#56565C',
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
    width: 110,
  },
  meterFill: {
    backgroundColor: COLORS.purple,
    borderRadius: 999,
    height: '100%',
    width: '50%',
  },
  generateButton: {
    alignItems: 'center',
    backgroundColor: COLORS.blue,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 12,
    height: 48,
    justifyContent: 'center',
    marginTop: 2,
    width: '100%',
  },
  generateButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  disabledButton: {
    opacity: 0.72,
  },
  generateButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
  },
  repliesScreen: {
    paddingHorizontal: 16,
  },
  repliesScrollContent: {
    alignItems: 'center',
    gap: 16,
    paddingBottom: 24,
    paddingTop: 22,
  },
  repliesControlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  toneSelector: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: '#B7B7BE',
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 9,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 22,
    width: 190,
  },
  toneSelectorText: {
    color: '#D6D6DB',
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 17,
    minWidth: 0,
  },
  replyCards: {
    gap: 14,
    width: '100%',
  },
  repliesLoadingCard: {
    alignItems: 'center',
    backgroundColor: '#151515',
    borderColor: '#2B2B2F',
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    minHeight: 164,
    justifyContent: 'center',
    padding: 20,
    width: '100%',
  },
  repliesLoadingText: {
    color: '#D6D6DB',
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
  },
  replyCard: {
    backgroundColor: '#151515',
    borderColor: '#2B2B2F',
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    width: '100%',
  },
  recommendedReplyCard: {
    backgroundColor: '#0C111D',
    borderColor: COLORS.blue,
    borderWidth: 1,
  },
  recommendedBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#15265E',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    height: 22,
    paddingHorizontal: 10,
  },
  recommendedBadgeText: {
    color: '#4D8CFF',
    fontFamily: FONTS.bodyRegular,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 15,
  },
  replyCardBody: {
    gap: 22,
    paddingHorizontal: 22,
    paddingTop: 22,
  },
  replyCardBodySecondary: {
    gap: 0,
    paddingBottom: 18,
    paddingTop: 26,
  },
  replyText: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 23,
    fontWeight: '700',
    lineHeight: 30,
  },
  whyItWorks: {
    gap: 2,
  },
  whyItWorksTitle: {
    color: '#D6D6DB',
    fontFamily: FONTS.body,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 17,
  },
  whyItWorksText: {
    color: '#D6D6DB',
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 16,
  },
  copyButton: {
    alignItems: 'center',
    backgroundColor: COLORS.blue,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 10,
    height: 48,
    justifyContent: 'center',
    marginTop: 26,
    width: '100%',
  },
  copyButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 19,
    fontWeight: '600',
    lineHeight: 24,
  },
  newRepliesButton: {
    alignItems: 'center',
    backgroundColor: '#454545',
    borderRadius: 999,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    height: 40,
    justifyContent: 'center',
  },
  newRepliesButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 20,
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetPanel: {
    alignItems: 'stretch',
    backgroundColor: '#111113',
    borderTopColor: '#2B2B2F',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    gap: 18,
    paddingBottom: 34,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#4A4A50',
    borderRadius: 999,
    height: 5,
    width: 48,
  },
  sheetTitle: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    textAlign: 'center',
  },
  toneOptions: {
    gap: 12,
    width: '100%',
  },
  toneOption: {
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderColor: '#2B2B2F',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 24,
    width: '100%',
  },
  toneOptionSelected: {
    backgroundColor: '#0C1427',
    borderColor: COLORS.blue,
  },
  toneOptionLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minWidth: 0,
  },
  toneOptionText: {
    color: 'rgba(255, 255, 255, 0.92)',
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
    minWidth: 0,
  },
  toneOptionTextSelected: {
    color: '#6EA0FF',
  },
  toneOptionCheckSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
    width: 24,
  },
});
