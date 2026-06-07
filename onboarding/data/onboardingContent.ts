import type { OnboardingStepContent } from '../types/onboarding';

export const onboardingContent: Record<OnboardingStepContent['id'], OnboardingStepContent> = {
  welcome: {
    id: 'welcome',
    title: 'Never overthink a reply again',
    titleParts: [
      { text: 'Never ' },
      { color: 'blue', text: 'overthink' },
      { text: ' a reply again' },
    ],
    body: 'Wingr helps you turn awkward, dry, or flirty moments into replies that actually sound like you.',
    ctaLabel: 'Get Started',
  },
  problem: {
    id: 'problem',
    title: 'What do you struggle with most?',
    titleParts: [
      { text: 'What do you ' },
      { color: 'blue', text: 'struggle with most' },
      { text: '?' },
    ],
    body: '',
    ctaLabel: 'Next',
    requiresSelection: true,
    choices: [
      { id: 'starting', title: 'Starting the conversation' },
      { id: 'keeping-going', title: 'Keeping the conversation going' },
      { id: 'flirting', title: 'Flirting without being cringe' },
      { id: 'meaning', title: 'Knowing what they mean' },
    ],
  },
  change: {
    id: 'change',
    title: 'What would better texting change for you?',
    titleParts: [
      { text: 'What would better texting\n' },
      { color: 'blue', text: 'change for you?' },
    ],
    body: '',
    ctaLabel: 'Next',
    requiresSelection: true,
    choices: [
      { id: 'confidence', title: "I'd feel more confident" },
      { id: 'dates', title: "I'd turn chats into dates" },
      { id: 'interest', title: "I'd show interest better" },
      { id: 'dying', title: "I'd stop conversations from dying" },
    ],
  },
  wouldYouSend: {
    id: 'wouldYouSend',
    title: 'If Wingr gave you a reply that felt right, would you send it?',
    titleParts: [
      { text: 'If Wingr gave you a reply\nthat felt right, ' },
      { color: 'blue', text: 'would you\nsend it?' },
    ],
    body: '',
    ctaLabel: 'Next',
    requiresSelection: true,
    choices: [
      { id: 'sounds-like-me', title: 'Yes, if it sounds like me' },
      { id: 'overthink', title: 'Maybe, I usually overthink' },
      { id: 'natural', title: 'Only if it feels natural' },
      { id: 'inspiration', title: "I'd use it for inspiration" },
    ],
  },
  privacy: {
    id: 'privacy',
    title: 'Your privacy matters to us',
    titleParts: [
      { text: 'Your privacy ' },
      { color: 'blue', text: 'matters to us' },
    ],
    body: 'Your chats can be personal. Wingr only uses your screenshot to understand the vibe and generate replies.',
    ctaLabel: 'Next',
  },
  uploadScreenshot: {
    id: 'uploadScreenshot',
    title: 'Try WINGR on a real chat',
    titleParts: [
      { text: 'Try WINGR on ' },
      { color: 'blue', text: 'a real chat' },
    ],
    body: "Upload a screenshot and Wingr will read the vibe, spot what's really going on, and suggest replies you can actually send.",
    ctaLabel: 'Next',
  },
  vibecheck: {
    id: 'vibecheck',
    title: 'Checking the vibe',
    titleParts: [
      { text: 'Checking ' },
      { color: 'blue', text: 'the vibe' },
    ],
    body: 'Reading the chat so you don’t have to overthink it.',
    ctaLabel: 'Get replies',
  },
  replies: {
    id: 'replies',
    title: 'Your reply',
    body: 'Based on the vibe, these are your best next moves.',
    ctaLabel: 'Next',
  },
  rating: {
    id: 'rating',
    title: 'Give us a rating',
    titleParts: [
      { text: 'Give us a ' },
      { color: 'blue', text: 'rating' },
    ],
    body: 'Your feedback really helps us improve and reach more people who need WiNGR.',
    ctaLabel: 'Next',
  },
  paywall: {
    id: 'paywall',
    title: 'Unlock WiNGR to keep the chats going',
    titleParts: [
      { color: 'blue', text: 'Unlock WiNGR' },
      { text: ' to keep the chats going' },
    ],
    body: 'Unlock instant vibe checks and sendable replies for the chats that actually matter.',
    ctaLabel: 'Start Free Trial',
  },
};
