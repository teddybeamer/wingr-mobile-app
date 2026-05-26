# Wingr Project Context

Wingr is a mobile-first AI dating assistant that helps users understand the vibe of a dating conversation and write better replies.

The product should feel like a premium, dark-mode, chat-native app: fast, simple, contextual, and useful in the exact moment where the user does not know what to reply.

Wingr should not feel like a static mockup, a generic chatbot, or a form-based AI tool. It should feel like a real app flow where the user uploads a screenshot, gets an intelligent vibe check, and can quickly copy a good reply.

## Current Build Goal

Build the real functional MVP flow.

Do not build static mock screens.

The first implementation should have real app state, real screen transitions, real copy actions, tone selection, and an isolated AI service layer.

The AI output can be mocked for now, but it must be structured as async functions so it can later be swapped with real API calls.

## Product Goal

Help users go from:

1. “I don’t know what to reply”
2. to understanding the vibe of the conversation
3. to getting 2 useful replies they can copy and send

The core product value is not the UI alone. The value is that Wingr feels like it understands the conversation and gives replies that sound natural, socially aware, and easy to actually send.

## Core UX Flow

The MVP should be built around one main 3-step flow:

1. Upload screenshot
2. Automatic vibe check
3. Suggested replies

The flow should be functional and feel like a real app.

---

## Screen 1: Upload Screenshot

The user starts by selecting or uploading a screenshot of a dating chat.

### Purpose

Let the user provide context quickly without typing the conversation manually.

### Requirements

- User can choose/select a screenshot.
- Store the selected screenshot URI in app state.
- The screen should clearly explain what Wingr does.
- The upload CTA should be obvious and primary.
- The UI should feel lightweight, premium, and mobile-first.
- Do not ask the user to fill out tone, context, or settings before uploading.
- After screenshot selection, automatically transition into an analyzing state.
- After analysis, show the vibe check.

### Example UX copy

Main title:

Upload a chat screenshot

Subcopy:

Wingr reads the vibe and helps you reply without sounding dry, needy, or forced.

CTA:

Choose screenshot

### Empty state behavior

Before upload, the screen should feel focused and calm. The user should immediately understand that the screenshot is the starting point.

### Loading/analyzing state

After upload, show an analyzing state.

Example copy:

Reading the vibe...

or:

Analyzing the conversation...

The analyzing state should feel fast and polished. Avoid making the app feel fake or static.

---

## Screen 2: Automatic Vibe Check

After the screenshot is uploaded, Wingr automatically analyzes the conversation and shows a vibe check.

The user should not have to manually ask for the analysis.

### Purpose

Give the user a quick read on what is happening in the conversation before generating replies.

This builds trust because Wingr first proves that it understands the situation.

### Requirements

- Automatically show a vibe check after screenshot analysis.
- Use structured data from the AI service layer.
- Show a concise summary of the conversation state.
- The output should feel helpful, not judgmental.
- Ask the user if they want to generate replies.
- Provide a clear primary CTA: Generate replies.
- Provide a secondary action: Upload new screenshot.

### Vibe Check Content

The vibe check should include:

- Their interest level
- Conversation energy
- Best move
- Risk / what to avoid
- Short summary

### Example structure

Vibe check

Their interest: Medium  
Conversation energy: Dry but recoverable  
Best move: Playful nudge  
Risk: Don’t over-invest  

Summary:  
This feels a little dry, but still recoverable. Keep it playful and low-pressure instead of trying too hard.

### Example UX copy

Intro message:

Got it. This feels dry, but still recoverable. I’d keep it playful and low-pressure.

Primary CTA:

Generate replies

Secondary action:

Upload new screenshot

---

## Screen 3: Suggested Replies

After the user taps Generate replies, Wingr shows exactly 2 suggested replies.

The user can copy a reply, change tone, regenerate replies, or upload a new screenshot.

### Purpose

Give the user useful, ready-to-send replies without overwhelming them.

### Requirements

- Show exactly 2 replies by default.
- Each reply should have a clear tone label.
- Each reply should have a copy button.
- User can copy a reply to clipboard.
- User can change tone and regenerate replies.
- User can upload a new screenshot and restart the flow.
- Replies should be contextual to the screenshot and vibe check.
- Avoid generic replies.
- Avoid overly cringe, needy, robotic, pickup-artist, or over-written language.

### Reply Card Structure

Each reply card should include:

- Tone label
- Reply text
- Copy button

### Example reply cards

Recommended

“Okay, I’ll give you that one — but I’m expecting slightly better energy next round.”

Copy

More playful

“That was almost a real answer. I’m proud of us.”

Copy

### Available Tone Options

Tone options can include:

- Recommended
- Playful
- Flirty
- Softer
- More direct
- Casual

### Tone UX

Do not force the user to choose tone before they get value.

The default flow should be:

1. Upload screenshot
2. Get vibe check
3. Generate recommended replies
4. Optionally change tone after seeing the replies

Tone selection should feel lightweight and easy. It should not feel like a settings panel.

---

## Functional Requirements

This project should be built as a real functional MVP, not a static UI mock.

### Required behavior

- User can select/upload a screenshot.
- App stores the selected screenshot URI in state.
- App shows an analyzing state after screenshot selection.
- App calls analyzeScreenshot().
- App displays the returned vibeCheck object.
- User can tap Generate replies.
- App calls generateReplies().
- App displays exactly 2 replies.
- User can copy a reply.
- User can change tone.
- Changing tone regenerates replies.
- User can upload a new screenshot and restart the flow.

### Required app states

The flow should support these states:

- upload
- analyzing
- vibeCheck
- generatingReplies
- replies

The app should not be built as disconnected screens with hardcoded content. It should be built as one coherent product flow.

---

## Suggested App Structure

Use a clean structure like this:

app/
- index.tsx

components/
- UploadCard.tsx
- VibeCheckCard.tsx
- ReplyCard.tsx
- ToneSelector.tsx
- LoadingState.tsx

lib/
- wingr-ai.ts

types/
- wingr.ts

utils/
- clipboard.ts

The exact file structure can be adjusted to fit the existing project, but keep the logic separated.

Do not hardcode all app logic inside one large UI file.

---

## AI Service Layer

Create a file called:

lib/wingr-ai.ts

This file should export async functions:

analyzeScreenshot(screenshotUri)

generateReplies(params)

For now, these functions can return realistic mock responses.

Important: even if the responses are mocked, the functions must be async and shaped like real service functions. This makes it easy to replace them later with OpenRouter, OpenAI, DeepSeek, Claude, or another model provider.

### analyzeScreenshot should return

A structured vibeCheck object with:

- interestLevel
- conversationEnergy
- bestMove
- risk
- summary

### generateReplies should accept

- vibeCheck
- selectedTone
- screenshotUri

### generateReplies should return

Exactly 2 reply objects.

Each reply should include:

- id
- tone
- text

---

## Data Model / Types

Create shared TypeScript types in:

types/wingr.ts

Suggested types:

type WingrFlowStatus =
  | "upload"
  | "analyzing"
  | "vibeCheck"
  | "generatingReplies"
  | "replies";

type ReplyTone =
  | "recommended"
  | "playful"
  | "flirty"
  | "softer"
  | "direct"
  | "casual";

type VibeCheck = {
  interestLevel: "Low" | "Medium" | "High" | "Unclear";
  conversationEnergy: string;
  bestMove: string;
  risk: string;
  summary: string;
};

type SuggestedReply = {
  id: string;
  tone: ReplyTone | string;
  text: string;
};

type WingrFlowState = {
  status: WingrFlowStatus;
  screenshotUri: string | null;
  vibeCheck: VibeCheck | null;
  replies: SuggestedReply[];
  selectedTone: ReplyTone;
  error: string | null;
};

---

## MVP Scope

For the first version, focus only on the core Wingr flow.

Build:

- Upload screenshot
- Analyzing state
- Automatic vibe check
- Generate 2 replies
- Copy reply
- Change tone
- Regenerate replies
- Upload new screenshot / restart

Do not build:

- Login
- Onboarding
- Dashboard
- Conversation history
- Settings page
- Payment
- Subscription
- User profile
- Gamification
- Social features
- Complex analytics
- Multiple saved chats

Keep the app brutally focused.

---

## Design Direction

Wingr should feel:

- premium
- dark
- sharp
- mobile-first
- compact
- slightly playful
- simple
- fast
- confidence-building

The app should feel closer to a polished AI chat assistant than a traditional form-based tool.

Use a compact single-column mobile layout.

The UI should prioritize:

- strong spacing
- clear hierarchy
- readable cards
- obvious CTAs
- fast interactions
- minimal friction

Avoid:

- generic chatbot bubbles everywhere
- too many buttons
- too many tone choices upfront
- large empty dashboards
- fake-looking mock content
- over-designed onboarding
- cluttered settings

---

## Important UX Principles

### 1. Screenshot-first

The user should not have to explain everything manually. The screenshot is the main input.

### 2. Fast path to value

The user should get from screenshot to useful replies in as few steps as possible.

### 3. Vibe before replies

Wingr should first show that it understands the situation before giving replies. This builds trust.

### 4. Two replies, not ten

Too many options create friction. Start with 2 strong replies.

### 5. Copy is the main action

The end goal is for the user to copy a reply and use it.

### 6. Tone can be adjusted after value is shown

Do not force tone selection before the user gets the first result. Let them change tone after seeing the initial replies.

### 7. Real flow over static mock

The app should be built with real state and real transitions, even if the AI responses are mocked for now.

---

## AI Behavior

Wingr should not produce generic dating advice.

It should understand:

- who sent the last message
- whether the conversation is dry, playful, warm, flirty, awkward, or risky
- whether the user should match energy, create tension, ask a question, or pull back
- whether the suggested reply sounds natural
- whether the user risks over-investing
- whether the reply should be short, playful, softer, or more direct

### AI should avoid

- sounding desperate
- over-investing too early
- cringe pickup lines
- overly formal language
- generic compliments
- robotic phrasing
- moralizing the user
- giving too many options
- long explanations when the user needs a reply
- fake “dating coach” energy

### AI should prefer

- playful confidence
- light teasing
- natural language
- short replies
- context-aware callbacks
- low-pressure tone
- replies that are easy to actually send

---

## Error Handling

Add basic error states.

If screenshot selection fails:

Show a clear message and let the user try again.

If analysis fails:

Show a clear message and let the user retry or upload a new screenshot.

If reply generation fails:

Show a clear message and let the user retry.

Do not crash the flow.

---

## Acceptance Criteria

The implementation is successful when:

1. I can select/upload a screenshot.
2. The app stores the screenshot URI.
3. I see an analyzing state.
4. I get a structured vibe check.
5. I can tap Generate replies.
6. I see exactly 2 suggested replies.
7. I can copy a reply.
8. I can change tone and regenerate replies.
9. I can upload a new screenshot and restart.
10. The AI logic is isolated in lib/wingr-ai.ts.
11. Types are isolated in types/wingr.ts.
12. The UI feels like a real product flow, not static mock screens.
13. No extra features like login, dashboard, history, or payment are added.

---

## Current Priority

Build the core product flow first.

The most important thing is that the user can:

1. upload a screenshot
2. get an automatic vibe check
3. generate 2 replies
4. copy one reply
5. change tone if needed
6. upload a new screenshot and start over

Do not expand the product before this flow feels good.