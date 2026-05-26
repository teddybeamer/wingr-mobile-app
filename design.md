# Wingr Design System

Wingr is a mobile-first dating conversation assistant with a dark, premium, chat-native interface.

Use the reference screenshots as the visual source of truth. Do not invent a new style. This file defines the visual rules Codex should follow when building screens and components.

---

## 1. Brand Feel

Wingr should feel:

- Premium
- Dark
- Minimal
- Sharp
- Mobile-native
- Socially aware
- Slightly playful
- Fast and focused

Wingr should not feel:

- Like a generic AI chatbot
- Like a SaaS dashboard
- Like a dating coach blog
- Like a childish Gen Z toy
- Overly colorful
- Overly gamified
- Overly animated

The UI should feel like a polished consumer mobile app.

---

## 2. Core Colors

Use these custom colors:

- App background: `#080808`
- Primary blue: `#1970FD`

Use `#080808` as the background across all screens.

Use `#1970FD` for:

- Main screen titles
- Primary CTA buttons
- Active/selected states
- Recommended reply card border
- Important badges
- Primary icon accents

Do not replace the primary blue with Tailwind blue.

---

## 3. Tailwind Color Rules

Use Tailwind colors for everything else.

Use Tailwind neutral colors for:

- Text
- Cards
- Borders
- Secondary buttons
- Muted UI
- Timestamps
- Dividers

Recommended mapping:

- `neutral-50`: Primary/high-contrast text
- `neutral-100`: Strong text
- `neutral-200`: Section titles and important body text
- `neutral-300`: Default body text
- `neutral-400`: Secondary body text
- `neutral-500`: Metadata, timestamps, subtle labels
- `neutral-700`: Secondary action buttons
- `neutral-800`: Borders and dividers
- `neutral-900`: Main card surfaces
- `neutral-950`: Deep surfaces

Use secondary buttons with `neutral-700`.

---

## 4. Layout

Wingr is mobile-first only.

Design for 320px–390px wide screens.

Use:

- Single-column layout
- Default horizontal screen padding: `20px`
- Dense but not cramped spacing
- Stacked cards and sections
- Minimal empty space

Spacing rhythm:

- `8px`: tiny gaps
- `12px`: related elements
- `16px`: compact card spacing
- `20px`: standard card padding / section spacing
- `24px`: larger separation
- `32px`: major screen separation

---

## 5. Typography

Use brand fonts if installed. Otherwise use system font fallback.

Typography should feel:

- Bold where it matters
- Compact
- High contrast
- Mobile-native
- Clean and readable

Recommended sizing:

- Screen title: `24–28px`, bold, primary blue, centered
- Section title: `17–22px`, semibold/bold
- Card title: `15–17px`, semibold
- Body text: `14–16px`
- Metadata/timestamps: `11–13px`, muted

Avoid oversized marketing-style typography inside the app.

---

## 6. Header

Header structure:

- Back arrow on the left
- Centered screen title
- Optional empty right side for balance

Back icon:

- White or `neutral-200`
- Simple and minimal
- Not inside a heavy button

Title:

- Center aligned
- `#1970FD`
- Bold

---

## 7. UI Primitives

### Cards

Default card style:

- Surface: `neutral-900` or `neutral-950`
- Border: `neutral-800`
- Radius: `20–24px`
- Padding: `16–20px`

Cards should feel soft, dark, and premium.

### Borders

- Default border: `neutral-800`
- Active/recommended border: `#1970FD`
- Border width: `1px`

Use primary blue only for selected, active, or recommended elements.

### Radius

Use:

- `16px`: message bubbles and small cards
- `20px`: standard cards
- `24px`: large cards / previews
- `999px`: pills and CTA buttons

### Dividers

Use subtle dividers:

- Height: `1px`
- Color: `neutral-800`
- Low opacity if needed

### Shadows

Keep shadows minimal. Use surface contrast, borders, spacing, and typography hierarchy instead.

Avoid heavy shadows, neon glows, or bright outer glows.

---

## 8. Chat Interface Pattern

Wingr can communicate using chat-style rows.

Assistant avatar:

- Small square avatar
- Dark blue surface
- Primary blue “W”
- Rounded corners
- Size: `36–40px`
- Positioned left of message bubbles

Assistant message bubble:

- Surface: `neutral-900`
- Text: `neutral-100` / `neutral-200`
- Border radius: `16–18px`
- Padding: `12–16px`
- Max width should leave room for the avatar

Timestamp:

- Small
- Muted
- `neutral-500`

---

## 9. Vibe Check Card

The vibe check card contains structured analysis.

It should use:

- Big blue title
- Stacked insight rows
- Colored icon blocks
- Muted labels
- Strong values
- Thin dividers between rows

Each row includes:

- Icon block
- Label
- Value
- Optional progress indicator

Suggested accent colors:

- Interest: violet / indigo
- Conversation energy: amber / orange
- Best move: teal / cyan
- Risk: red
- Recommended: primary blue

Use Tailwind accent colors where possible:

- `violet-500`
- `amber-400`
- `teal-400`
- `red-500`

Keep accent colors controlled and limited to insight values, icons, and small UI accents.

---

## 10. Reply Cards

Reply cards are focused content cards.

Recommended reply card:

- Dark surface
- Primary blue border
- Blue badge
- Large reply text
- “Why it works” explanation
- Action row at bottom

Secondary reply card:

- Neutral dark surface
- Neutral border
- Optional accent badge
- Same structure as recommended card

Reply text:

- Large
- Bold
- `neutral-50`
- Tight but readable line height

“Why it works” text:

- Smaller than reply text
- `neutral-300` / `neutral-400`
- Clear but secondary

Secondary reply cards should still feel useful, not disabled.

---

## 11. Buttons

### Primary Buttons

Use primary buttons for main actions.

Examples:

- Analyze screenshot
- Generate replies in this tone
- Generate new replies
- Copy

Style:

- Background: `#1970FD`
- Text: white or near-white
- Full width when used as the main screen CTA
- Rounded pill shape
- Height: `48–56px`
- Semibold/bold text

### Secondary Buttons

Use secondary buttons for lower-priority actions.

Examples:

- New reply
- Keep current replies

Style:

- Background: `neutral-700`
- Text: `neutral-100` / `neutral-200`
- Rounded pill
- Icon optional
- Smaller width allowed

Secondary buttons should not compete with primary blue CTAs.

---

## 12. Badges

Badges are used for small status labels.

Examples:

- Recommended
- Softer
- Playful
- Flirty

Badge style:

- Rounded pill
- Small text
- Optional icon
- Subtle tinted background
- Matching accent text

Recommended badge:

- Blue tinted background
- Primary blue text/icon

Badges should be compact and should not dominate the card.

---

## 13. Icons

Use Solar icons as the primary icon library.

Icon rules:

- Use Solar icons wherever possible.
- Prefer outline or bold-duotone icons depending on the reference.
- Icons should be simple and expressive.
- Do not mix icon libraries unless necessary.

Icon use cases:

- Back arrow
- Heart / interest
- Lightning / energy
- Sparkle / best move
- Warning / risk
- Copy
- Refresh / new reply
- Recommended badge

Icon containers:

- Small rounded square
- Dark tinted background
- Accent icon color

---

## 14. Motion

Motion should be minimal and functional.

Allowed:

- Subtle loading states
- Button press feedback
- Copy confirmation feedback
- Small state transitions

Avoid:

- Confetti
- Bouncy animations
- Gamified motion
- Large transitions that slow the flow

The app should feel fast and calm.

---

## 15. UI Copy Tone

Wingr UI copy should be:

- Short
- Confident
- Helpful
- Slightly playful
- Non-judgmental

Good examples:

- “All right, let’s check the temperature.”
- “Want me to suggest a message based on this?”
- “Got you. Based on the vibe, I’d keep it playful — interested, but not over-invested.”
- “Why it works:”
- “Dry but recoverable.”
- “Don’t over-invest.”

Avoid:

- “AI has completed your romantic optimization.”
- “Maximize your dating conversion.”
- “Seduce them with this reply.”
- “Your flirting score is insufficient.”

---

## 16. Implementation Rules for Codex

When implementing Wingr UI:

- Use `#080808` as the app background.
- Use `#1970FD` as the primary blue.
- Use Tailwind neutral colors for text, cards, borders, and secondary buttons.
- Use Solar icons.
- Match the provided reference screens closely.
- Keep everything mobile-first.
- Keep layouts dense, dark, and premium.
- Do not redesign the product into a generic AI assistant.
- Do not add missing UX features unless explicitly asked.
- Do not analyze or fix product gaps from screenshots unless instructed.

The screenshots are design references, not a full product spec.

Store reference screenshots like this:

_reference/
  vibe-check-reference.png
  replies-reference.png