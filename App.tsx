import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  AltArrowDown,
  Bolt,
  CheckCircle,
  ChatRound,
  Copy,
  EmojiFunnyCircle,
  FaceScanSquare,
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
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { analyzeScreenshot, generateReplies } from './lib/wingr-ai';
import type {
  ReplyTone,
  RecommendedReplyTone,
  SuggestedReply,
  ToneOption,
  UserStylePreference,
  VibeCheck,
} from './types/wingr';

const heroImage = require('./assets/images/screen1-screenshotupload.png');

const FONTS = {
  display: 'ClashDisplay',
  body: 'ClashGrotesk',
  bodyRegular: 'ClashGroteskRegular',
};

const COLORS = {
  background: '#050505',
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

type Screen = 'upload' | 'analyzing' | 'vibecheck' | 'replies';
type MetricVariant = 'interest' | 'energy' | 'risk' | 'move';

const TONE_OPTIONS: ToneOption[] = [
  { value: 'sound_more_like_me', label: 'Sound more like me', icon: FaceScanSquare },
  { value: 'playful', label: 'Playful', icon: EmojiFunnyCircle },
  { value: 'direct', label: 'Direct', icon: FireMinimalistic },
  { value: 'casualSmallTalk', label: 'Casual small talk', icon: Waterdrop },
];

function getToneLabel(tone: ReplyTone | RecommendedReplyTone) {
  return TONE_OPTIONS.find((option) => option.value === tone)?.label ?? 'Playful';
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
  const [screen, setScreen] = useState<Screen>('upload');
  const [selectedScreenshotUri, setSelectedScreenshotUri] = useState<string | null>(null);
  const [chatTranscript, setChatTranscript] = useState('');
  const [extraContext, setExtraContext] = useState('');
  const [replyContext, setReplyContext] = useState('');
  const [selectedTone, setSelectedTone] = useState<ReplyTone>('playful');
  const [suggestedReplies, setSuggestedReplies] = useState<SuggestedReply[]>([]);
  const [vibeCheck, setVibeCheck] = useState<VibeCheck | null>(null);
  const [ocrSource, setOcrSource] = useState<'backend' | 'mock' | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isGeneratingReplies, setIsGeneratingReplies] = useState(false);
  const [userStylePreference] = useState<UserStylePreference>({
    howTheyText: 'short and casual',
  });
  const [fontsLoaded] = useFonts({
    [FONTS.display]: require('./assets/fonts/ClashDisplay-Variable.ttf'),
    [FONTS.body]: require('./assets/fonts/ClashGrotesk-Variable.ttf'),
    [FONTS.bodyRegular]: require('./assets/fonts/ClashGrotesk-Regular.ttf'),
  });

  if (!fontsLoaded) {
    return <View style={styles.loadingScreen} />;
  }

  const generateRepliesForTone = async (tone: ReplyTone, nextContext: string) => {
    if (!vibeCheck || !chatTranscript) {
      throw new Error('Vibe check is not ready yet.');
    }

    return generateReplies({
      vibeCheck,
      selectedTone: tone,
      screenshotUri: selectedScreenshotUri,
      transcriptText: chatTranscript,
      extraContext: nextContext,
      userStylePreference: tone === 'sound_more_like_me' ? userStylePreference : undefined,
    });
  };

  const handleAnalyzeScreenshot = async (screenshotUri: string) => {
    setAnalysisError(null);
    setChatTranscript('');
    setVibeCheck(null);
    setOcrSource(null);
    setSuggestedReplies([]);
    setReplyContext('');
    setScreen('analyzing');

    try {
      const result = await analyzeScreenshot({ screenshotUri });

      setChatTranscript(result.transcriptText);
      setVibeCheck(result.vibeCheck);
      setOcrSource(result.ocr.source);
      setScreen('vibecheck');
    } catch {
      setAnalysisError('Wingr could not read that screenshot. Try another image.');
      Alert.alert('Could not read screenshot', 'Try another screenshot or upload again.');
      setScreen('upload');
    }
  };

  const handleUploadPress = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Photo access needed',
        'Wingr needs access to your photos so you can upload a text screenshot.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled) {
      const screenshotUri = result.assets[0].uri;

      setSelectedScreenshotUri(screenshotUri);
      await handleAnalyzeScreenshot(screenshotUri);
    }
  };

  const handleGenerateReplies = async () => {
    if (!vibeCheck) {
      Alert.alert('Vibe check needed', 'Upload a screenshot so Wingr can read the vibe first.');
      return;
    }

    const nextContext = extraContext.trim();
    const initialTone = vibeCheck.bestTone;
    setReplyContext(nextContext);
    setSelectedTone(initialTone);
    setIsGeneratingReplies(true);

    try {
      const replies = await generateRepliesForTone(initialTone, nextContext);

      setSuggestedReplies(replies);
      setScreen('replies');
    } catch {
      Alert.alert('Could not generate replies', 'Try again in a moment.');
    } finally {
      setIsGeneratingReplies(false);
    }
  };

  const handleToneChange = async (tone: ReplyTone) => {
    setSelectedTone(tone);

    const nextReplies = await generateRepliesForTone(tone, replyContext);
    setSuggestedReplies(nextReplies);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      {screen === 'upload' ? (
        <UploadScreen
          analysisError={analysisError}
          selectedScreenshotUri={selectedScreenshotUri}
          onUploadPress={handleUploadPress}
        />
      ) : null}

      {screen === 'analyzing' ? (
        <AnalyzingScreen selectedScreenshotUri={selectedScreenshotUri} />
      ) : null}

      {screen === 'vibecheck' && vibeCheck ? (
        <VibeCheckScreen
          chatTranscript={chatTranscript}
          extraContext={extraContext}
          ocrSource={ocrSource}
          selectedScreenshotUri={selectedScreenshotUri}
          onBack={() => setScreen('upload')}
          isGeneratingReplies={isGeneratingReplies}
          onGenerateReplies={handleGenerateReplies}
          vibeCheck={vibeCheck}
          onUploadNew={handleUploadPress}
          onExtraContextChange={setExtraContext}
        />
      ) : null}

      {screen === 'replies' && vibeCheck ? (
        <RepliesScreen
          chatTranscript={chatTranscript}
          extraContext={replyContext}
          isGeneratingReplies={isGeneratingReplies}
          onBack={() => setScreen('vibecheck')}
          onRepliesChange={setSuggestedReplies}
          onToneChange={handleToneChange}
          replies={suggestedReplies}
          screenshotUri={selectedScreenshotUri}
          selectedTone={selectedTone}
          userStylePreference={userStylePreference}
          vibeCheck={vibeCheck}
        />
      ) : null}
    </SafeAreaView>
  );
}

function UploadScreen({
  analysisError,
  selectedScreenshotUri,
  onUploadPress,
}: {
  analysisError: string | null;
  selectedScreenshotUri: string | null;
  onUploadPress: () => void;
}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.logo}>Wingr</Text>

      <Image source={heroImage} resizeMode="contain" style={styles.heroImage} />

      <View style={styles.uploadSection}>
        <Text style={styles.sectionTitle}>Upload Text Screenshot</Text>
        {analysisError ? <Text style={styles.errorText}>{analysisError}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Upload text screenshot"
          onPress={onUploadPress}
          style={({ pressed }) => [styles.uploadButton, pressed && styles.uploadButtonPressed]}
        >
          {selectedScreenshotUri ? (
            <ImageBackground
              imageStyle={styles.selectedImage}
              resizeMode="cover"
              source={{ uri: selectedScreenshotUri }}
              style={styles.selectedPreview}
            >
              <View style={styles.selectedOverlay}>
                <Text style={styles.uploadText}>Screenshot selected</Text>
                <Text style={styles.uploadSubtext}>Press to choose another</Text>
              </View>
            </ImageBackground>
          ) : (
            <View style={styles.uploadEmptyState}>
              <Text style={styles.uploadText}>Press to upload screenshot</Text>
              <View style={styles.plusButton}>
                <Text style={styles.plusText}>+</Text>
              </View>
            </View>
          )}
        </Pressable>
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
      <Text style={styles.analyzingText}>Wingr is reading the screenshot and preparing the vibe check.</Text>
    </View>
  );
}

function VibeCheckScreen({
  chatTranscript,
  extraContext,
  isGeneratingReplies,
  ocrSource,
  selectedScreenshotUri,
  onBack,
  onExtraContextChange,
  onGenerateReplies,
  onUploadNew,
  vibeCheck,
}: {
  chatTranscript: string;
  extraContext: string;
  isGeneratingReplies: boolean;
  ocrSource: 'backend' | 'mock' | null;
  selectedScreenshotUri: string | null;
  onBack: () => void;
  onExtraContextChange: (value: string) => void;
  onGenerateReplies: () => void;
  onUploadNew: () => void;
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
            <Text style={styles.backButtonText}>‹</Text>
          </Pressable>
          <Text style={styles.vibeHeaderTitle}>Vibe Check</Text>
          <View style={styles.backButton} />
        </View>

        {selectedScreenshotUri ? (
          <View style={styles.uploadedPreviewRow}>
            <Image
              resizeMode="cover"
              source={{ uri: selectedScreenshotUri }}
              style={styles.uploadedPreviewImage}
            />
            <View style={styles.uploadedPreviewCopy}>
              <Text style={styles.uploadedPreviewLabel}>Screenshot uploaded</Text>
              <Text style={styles.uploadedPreviewText}>Wingr analyzed this conversation.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Upload a new screenshot"
              onPress={onUploadNew}
              style={({ pressed }) => [
                styles.uploadNewButton,
                pressed && styles.uploadButtonPressed,
              ]}
            >
              <Text style={styles.uploadNewButtonText}>New</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.transcriptCard}>
          <View style={styles.transcriptHeader}>
            <Text style={styles.transcriptLabel}>Parsed chat</Text>
            <Text style={styles.transcriptSource}>
              {ocrSource === 'backend' ? 'OCR' : 'Mock OCR'}
            </Text>
          </View>
          <Text numberOfLines={5} style={styles.transcriptText}>
            {chatTranscript || 'No transcript captured yet.'}
          </Text>
        </View>

        <View style={styles.vibeCard}>
          <Text style={styles.vibeCardTitle}>Vibe check</Text>
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
            value={vibeCheck.conversationEnergy}
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

        <View style={styles.contextSection}>
          <Text style={styles.contextTitle}>Add extra context</Text>
          <Text style={styles.contextHelper}>This is optional.</Text>
          <TextInput
            multiline
            onChangeText={onExtraContextChange}
            placeholder="Anything Wingr should know? e.g. you want to keep it playful, you haven't replied in 2 days, or this is from Hinge."
            placeholderTextColor="#9B9BA3"
            style={styles.contextInput}
            textAlignVertical="top"
            value={extraContext}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Generate replies"
          disabled={isGeneratingReplies}
          onPress={onGenerateReplies}
          style={({ pressed }) => [
            styles.generateButton,
            pressed && styles.generateButtonPressed,
            isGeneratingReplies && styles.disabledButton,
          ]}
        >
          {isGeneratingReplies ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text style={styles.generateButtonText}>Generate replies</Text>
          )}
        </Pressable>
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
        <Text style={[styles.metricValue, { color: config.valueColor }]}>{value}</Text>
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
  chatTranscript,
  extraContext,
  onBack,
  onRepliesChange,
  onToneChange,
  replies,
  screenshotUri,
  selectedTone,
  userStylePreference,
  vibeCheck,
}: {
  chatTranscript: string;
  extraContext: string;
  isGeneratingReplies: boolean;
  onBack: () => void;
  onRepliesChange: (replies: SuggestedReply[]) => void;
  onToneChange: (tone: ReplyTone) => Promise<void>;
  replies: SuggestedReply[];
  screenshotUri: string | null;
  selectedTone: ReplyTone;
  userStylePreference: UserStylePreference;
  vibeCheck: VibeCheck;
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
      const nextReplies = await generateReplies({
        vibeCheck,
        selectedTone,
        screenshotUri,
        transcriptText: chatTranscript,
        extraContext,
        userStylePreference:
          selectedTone === 'sound_more_like_me' ? userStylePreference : undefined,
      });

      onRepliesChange(nextReplies);
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
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.vibeHeaderTitle}>Replies</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        bounces={false}
        contentContainerStyle={styles.repliesScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change reply tone"
          onPress={() => setIsToneSheetOpen(true)}
          style={({ pressed }) => [styles.toneSelector, pressed && styles.uploadButtonPressed]}
        >
          <ChatRound color="#D6D6DB" size={18} />
          <Text numberOfLines={1} style={styles.toneSelectorText}>
            {selectedToneLabel}
          </Text>
          <AltArrowDown color="#D6D6DB" size={18} />
        </Pressable>

        <View style={styles.replyCards}>
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Get new replies"
          disabled={isRefreshing}
          onPress={handleRegenerateReplies}
          style={({ pressed }) => [
            styles.newRepliesButton,
            pressed && styles.uploadButtonPressed,
            isRefreshing && styles.disabledButton,
          ]}
        >
          {isRefreshing ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <>
              <Refresh color={COLORS.white} size={22} />
              <Text style={styles.newRepliesButtonText}>Get new replies</Text>
            </>
          )}
        </Pressable>
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Copy reply"
        onPress={onCopy}
        style={({ pressed }) => [styles.copyButton, pressed && styles.generateButtonPressed]}
      >
        {copied ? (
          <CheckCircle color={COLORS.white} size={24} />
        ) : (
          <Copy color={COLORS.white} size={24} />
        )}
        <Text style={styles.copyButtonText}>{copied ? 'Copied' : 'Copy'}</Text>
      </Pressable>
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={option.value}
                  onPress={() => onSelect(option.value)}
                  style={({ pressed }) => [
                    styles.toneOption,
                    selected && styles.toneOptionSelected,
                    pressed && styles.uploadButtonPressed,
                  ]}
                >
                  <ToneIcon color={selected ? COLORS.blue : '#D6D6DB'} size={20} />
                  <Text style={[styles.toneOptionText, selected && styles.toneOptionTextSelected]}>
                    {option.label}
                  </Text>
                  {selected ? <CheckCircle color={COLORS.blue} size={21} /> : null}
                </Pressable>
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
  backButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 30,
  },
  vibeHeaderTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
    textAlign: 'center',
  },
  uploadedPreviewRow: {
    alignItems: 'center',
    backgroundColor: COLORS.panel,
    borderColor: '#232329',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 10,
  },
  uploadedPreviewImage: {
    backgroundColor: '#24242A',
    borderRadius: 12,
    height: 54,
    width: 42,
  },
  uploadedPreviewCopy: {
    flex: 1,
    gap: 2,
  },
  uploadedPreviewLabel: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  uploadedPreviewText: {
    color: COLORS.muted,
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  uploadNewButton: {
    alignItems: 'center',
    backgroundColor: '#202026',
    borderRadius: 999,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  uploadNewButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 13,
    fontWeight: '700',
  },
  transcriptCard: {
    backgroundColor: '#0D0D0F',
    borderColor: '#222229',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  transcriptHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  transcriptLabel: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  transcriptSource: {
    color: COLORS.muted,
    fontFamily: FONTS.bodyRegular,
    fontSize: 12,
    lineHeight: 16,
  },
  transcriptText: {
    color: '#C9C9CF',
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  vibeCard: {
    backgroundColor: COLORS.panelRaised,
    borderRadius: 12,
    gap: 0,
    padding: 10,
  },
  vibeCardTitle: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 32,
    marginBottom: 4,
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
  summaryCard: {
    backgroundColor: '#0D0D0F',
    borderColor: '#222229',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  summaryLabel: {
    color: COLORS.blue,
    fontFamily: FONTS.display,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
    marginBottom: 4,
  },
  summaryText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 21,
  },
  contextSection: {
    gap: 7,
  },
  contextTitle: {
    color: COLORS.white,
    fontFamily: FONTS.display,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  contextHelper: {
    color: '#B6B6BC',
    fontFamily: FONTS.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  contextInput: {
    backgroundColor: COLORS.panelRaised,
    borderRadius: 18,
    color: COLORS.white,
    fontFamily: FONTS.bodyRegular,
    fontSize: 16,
    lineHeight: 22,
    minHeight: 122,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  generateButton: {
    alignItems: 'center',
    backgroundColor: COLORS.blue,
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    marginTop: 2,
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
    fontSize: 19,
    fontWeight: '600',
    lineHeight: 24,
  },
  repliesScreen: {
    paddingHorizontal: 16,
  },
  repliesScrollContent: {
    alignItems: 'center',
    gap: 22,
    paddingBottom: 24,
    paddingTop: 22,
  },
  toneSelector: {
    alignItems: 'center',
    alignSelf: 'center',
    borderColor: '#B7B7BE',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 38,
    justifyContent: 'center',
    maxWidth: '82%',
    paddingHorizontal: 16,
  },
  toneSelectorText: {
    color: '#D6D6DB',
    fontFamily: FONTS.bodyRegular,
    fontSize: 16,
    lineHeight: 21,
  },
  replyCards: {
    gap: 14,
    width: '100%',
  },
  replyCard: {
    backgroundColor: '#151515',
    borderColor: '#2B2B2F',
    borderRadius: 24,
    borderWidth: 1,
    padding: 12,
    width: '100%',
  },
  recommendedReplyCard: {
    backgroundColor: '#0C111D',
    borderColor: COLORS.blue,
    borderWidth: 2,
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
    alignSelf: 'stretch',
    backgroundColor: '#454545',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 12,
    height: 48,
    justifyContent: 'center',
  },
  newRepliesButtonText: {
    color: COLORS.white,
    fontFamily: FONTS.body,
    fontSize: 19,
    fontWeight: '600',
    lineHeight: 24,
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetPanel: {
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
    gap: 10,
  },
  toneOption: {
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderColor: '#2B2B2F',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 16,
  },
  toneOptionSelected: {
    backgroundColor: '#0C1427',
    borderColor: COLORS.blue,
  },
  toneOptionText: {
    color: COLORS.white,
    flex: 1,
    fontFamily: FONTS.body,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  toneOptionTextSelected: {
    color: '#6EA0FF',
  },
});
