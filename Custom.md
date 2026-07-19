# Pine Launcher — iPhone Liquid Glass UI Redesign (100-Step Plan)

## Philosophy
Apple's liquid glass aesthetic (iOS 18+ / visionOS) is defined by: deep field-of-view depth, layered glass panes with variable translucency, vibrant neon accents that react to content, large-radius rounded corners, continuous fluid motion with spring physics, and a total absence of hard borders. Every surface looks like a pane of polished borosilicate glass with light playing through it.

---

## Phase 1 — Design Tokens & Foundation (Steps 1-15)

### Step 1: Replace all color tokens for a true-black + neon glass palette
Set `--bg-0` to `#000000` (pure black, not `#08080b`). The glass aesthetic demands true black behind the glass so the frosted layers pop. Set `--bg-1` to `rgba(255,255,255,0.03)`, `--bg-2` to `rgba(255,255,255,0.06)`, `--bg-3` to `rgba(255,255,255,0.10)`. Remove all flat dark greys — every surface is a glass tint now.

### Step 2: Define the Liquid Glass surface system
Create 5 glass depth levels: `--glass-surface-base` (no blur, just tint), `--glass-surface-raised` (backdrop-blur 20px, tint 0.04), `--glass-surface-overlay` (backdrop-blur 40px, tint 0.08), `--glass-surface-modal` (backdrop-blur 60px, tint 0.12), `--glass-surface-cinematic` (backdrop-blur 80px, tint 0.16). Every UI element maps to one of these five.

### Step 3: Replace accent colors with iOS-style vibrant neon
Set `--accent` to `#5e5ce6` (iOS system indigo), `--accent-2` to `#64d2ff` (iOS cyan), add `--accent-orange: #ff9f0a` (iOS orange for warnings), `--accent-green: #30d158` (iOS green for success), `--accent-red: #ff453a` (iOS red for danger). These match the SF Symbols color palette exactly.

### Step 4: Implement variable vibrancy via CSS layers
Use `@layer` to order: `tokens → glass → components → utilities`. The glass layer contains all backdrop-filter and opacity rules so they composite correctly without fighting other styles.

### Step 5: Create a noise/grain texture layer for realism
Replace the existing SVG noise with a subtle `background-image` using a tiny PNG grain texture (0.5% opacity, 200×200 tiled). Real glass has microscopic imperfections — this sells the illusion. Apply it as a `::before` on `body` with `mix-blend-mode: overlay`.

### Step 6: Replace all border-radius tokens for iOS curving
Set `--r-xs: 8px`, `--r-sm: 12px`, `--r-md: 16px`, `--r-lg: 22px`, `--r-xl: 28px`, `--r-pill: 9999px`. iOS uses larger radii than the current setup. Every edge should feel soft.

### Step 7: Define the inner shadow token system
Add `--glass-inner-shadow: inset 0 0.5px 0 rgba(255,255,255,0.12)` and `--glass-inner-shadow-deep: inset 0 0.5px 0 rgba(255,255,255,0.18), inset 0 -0.5px 0 rgba(0,0,0,0.2)`. Every glass surface needs a tiny top highlight to catch light like real glass.

### Step 8: Replace motion easings with iOS spring curves
Set `--ease-spring: cubic-bezier(0.32, 0.94, 0.6, 1)` (quiet spring), `--ease-spring-snappy: cubic-bezier(0.16, 1.3, 0.3, 1)` (iOS list spring), `--ease-ios: cubic-bezier(0.4, 0, 0.2, 1)` (system curve). These replace the current cubic-bezier values.

### Step 9: Define a comprehensive z-index layer system
Create `--z-glass: 1`, `--z-content: 2`, `--z-rail: 5`, `--z-topbar: 10`, `--z-dropdown: 20`, `--z-overlay: 30`, `--z-modal: 40`, `--z-toast: 50`, `--z-cmdk: 60`. Every component uses these tokens so layering is predictable.

### Step 10: Add light-leak gradient to the glass system
Define `--glass-leak: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)`. This subtle top-to-bottom white gradient mimics light entering the top of a glass pane. Apply it to all glass-surface variants.

### Step 11: Create the depth shadow token
Define `--shadow-glass-sm: 0 2px 8px rgba(0,0,0,0.4), 0 0.5px 0 rgba(255,255,255,0.06)`. Define `--shadow-glass-md`, `--shadow-glass-lg` with increasing blur and offset. iOS glass has distinct separation shadows.

### Step 12: Build a CSS reset that preserves glass layering
Update the reset to ensure `backdrop-filter` works on all elements. Set `isolation: isolate` on the `#app` container to create a new stacking context. Remove all `overflow: hidden` on container elements that might clip glass blur.

### Step 13: Add dynamic accent tinting based on content
Define CSS variables for content-aware tinting: `--tint-hue` (dynamic). When a user selects an instance, shift the accent hue toward that instance's color. Store the hue in a CSS custom property so glass reflections subtly shift color.

### Step 14: Create the glass morph utility classes
Build `.glass-1` through `.glass-5` utility classes that apply the correct surface background, blur, inner shadow, and border. Any element can become glass by adding one class.

### Step 15: Write the tokens documentation
Comment every token with its iOS equivalent (e.g., `--accent = iOS System Indigo #5e5ce6`). This makes future theming predictable.

---

## Phase 2 — Shell & Layout (Steps 16-30)

### Step 16: Eliminate all visible borders
Replace every `border: 1px solid var(--glass-edge)` with `box-shadow: 0 0.5px 0 rgba(255,255,255,0.06) inset`. Real glass separators are barely visible highlights, not hard lines. The existing hairline borders look cheap next to liquid glass.

### Step 17: Redesign the top bar as a Dynamic Island
Replace the flat top bar with a pill-shaped Dynamic Island centered at the top. The island contains: Pine Launcher wordmark on the left, a centered search trigger (rounded pill, 120px wide when collapsed), and account avatar on the right. The island expands on hover/interaction with a fluid 600ms spring animation.

### Step 18: Apply dual-layer glass to the top bar
The Dynamic Island has two layers: a deep glass pane (backdrop-blur 60px, tint 0.12) and a surface highlight layer (backdrop-blur 20px, tint 0.04, top light-leak). This creates the depth that real liquid glass has.

### Step 19: Replace the sidebar with a floating tab bar
Remove the left rail entirely. Replace it with a floating bottom tab bar (iOS-style) containing 5 tabs: Home, Discover, Library, Instance, Settings. The tab bar is a pill-shaped glass pane (backdrop-blur 40px, border-radius 28px) with a 16px margin on each side, floating above the content.

### Step 20: Add the Home indicator
At the very bottom of the window, add a slim home indicator pill (166×5px, radius 2.5px, white with 0.3 opacity) that mimics the iPhone home bar. This anchors the iOS aesthetic.

### Step 21: Implement spring-animated tab switching
When switching tabs, the bottom bar indicator (a small glowing pill behind the active icon) moves with a spring animation. Use CSS `translateX` with `transition: transform 600ms var(--ease-spring)`. The active icon also scales up 1.1× with a spring snap.

### Step 22: Redesign the account avatar as a live cutout
Replace the circular avatar with the iOS-style cutout: a rounded rectangle with continuous corner curve (UIRectCorner). When signed in, show the skin head filling the cutout. When signed out, show a "person" SF Symbol–style icon.

### Step 23: Add the signature iOS blurred backdrop
The entire `body::before` backdrop should use three large radial gradients positioned at top-left, center-right, and bottom-center, each with 800px+ radius and extremely low opacity (0.03-0.06). The colors dynamically shift based on the active view using CSS custom properties.

### Step 24: Create the view transition system
Each view transition uses iOS's push/pop navigation style: push new view from right with `translateX(100%) → translateX(0)` and simultaneously slide the old view to `translateX(-30%)` with scale 0.95. Duration 400ms with `var(--ease-ios)`.

### Step 25: Add the parallax depth effect
The content area has three scroll layers: background gradient (slowest, `translateZ(-2px)`), glass cards (medium, `translateZ(-1px)`), and content (normal). Use CSS 3D transforms to create a genuine depth-of-field effect when scrolling.

### Step 26: Implement rubber-banding overflow
When scrolling past the top or bottom of content, apply `overscroll-behavior: contain` and add a subtle spring resistance effect using `translateY` with a dynamic clamp.

### Step 27: Add the charging/connecting indicator
When a launch is in progress, the Dynamic Island expands to show a live activity indicator: instance name, progress, speed, ETA — all inside the island. This mimics iOS 18's Live Activities API.

### Step 28: Create the notification delivery system
Toasts should slide up from below the tab bar (not from the top-right), styled as iOS notification banners with the signature rounded-rect shape, left-aligned icon, and spring entrance.

### Step 29: Implement the widget-style home screen
The home page becomes a widget grid like iOS: a large "Continue Playing" widget (2×2), followed by smaller "Recent" widgets (1×2 horizontal), and a "Library" widget (2×1). Each widget has its own glass depth level.

### Step 30: Add the ambient light sensor effect
Use `@media (prefers-color-scheme)` and a JS-driven ambient light simulation: when the mouse moves to the top-right, the glass highlights shift to that corner. A subtle `radial-gradient` follows the cursor with a 2000ms delay — like light playing through real glass.

---

## Phase 3 — Glass Components (Steps 31-50)

### Step 31: Redesign all buttons as glass pills
Every button becomes a pill shape with glass background, no visible border, inner shadow for depth, and a 100ms spring scale-down on press (0.97×). Primary buttons get the vibrant accent gradient with a subtle glow.

### Step 32: Build the liquid button press effect
On `:active`, buttons don't just scale — they show a ripple effect. A `::after` pseudo-element expands from the click point (tracked via CSS custom properties `--ripple-x`, `--ripple-y`) with a radial-gradient that fades out over 400ms.

### Step 33: Redesign inputs as iOS text fields
Inputs become rounded rectangles (border-radius 12px) with a subtle glass background, no visible border when unfocused, and a vibrant accent border + glow on focus. The placeholder text uses `--text-lo` at 0.7 opacity. No more harsh text inputs.

### Step 34: Create the segmented control (iOS picker style)

### Step 34: Create the segmented control (iOS picker style)
Replace the current segmented buttons with a proper iOS-style picker: a single glass pill container with individual segments that have no borders between them. The active segment slides underneath with a glass highlight. Text on the active segment gets the accent color, inactive gets tertiary text.

### Step 35: Redesign cards as glass widgets
All cards become glass surfaces with `--glass-surface-raised`. Remove all card backgrounds. Cards float with `--shadow-glass-sm`. On hover, they elevate with `--shadow-glass-md` and a 2px upward spring translation.

### Step 36: Add the spring card stack effect
When cards appear in a grid, they don't just fade in — they spring up from below with a cascade delay. Each card's `animation-delay` is `calc(var(--i) * 50ms)` and the animation is a spring-based `translateY(20px) → translateY(0)`.

### Step 37: Redesign modals as sheet presentations
Modals should slide up from the bottom like iOS sheets, not fade in from the center. The sheet covers 85% of the screen height with a grabber handle at the top (6×40px pill, radius 3px). The background scrim is the standard iOS blur (backdrop-blur 40px, tint 0.2).

### Step 38: Add the sheet drag-to-dismiss
Implement a drag gesture on the sheet header: when the user drags down, the sheet tracks with `translateY`. Past a threshold (30% of screen height), the sheet animates off-screen with a spring and calls `closeModal()`.

### Step 39: Redesign the context menu (account menu) as an iOS action sheet
The account menu becomes a bottom action sheet: a list of glass rows with SF Symbol–style icons, rounded corners on the first and last items, and a cancel button separated by a gap. The menu slides up with a 400ms spring.

### Step 40: Build the glass divider component
Replace all `<hr>` and border-based dividers with a single glass line: 1px height, linear gradient from transparent → white(0.06) → transparent, width 100%. This matches iOS separator styles.

### Step 41: Redesign sliders and range controls
Any range selector (memory, volume) becomes an iOS-style slider: a thin glass track (4px, pill) with a vibrant accent fill on the left and a circular knob (24px, glass with inner shadow, spring animation on drag).

### Step 42: Build the toggle/switch component
Replace checkboxes with iOS toggle switches: 51×31px glass pill, accent fill when on, knob (27px) with inner shadow and a subtle drop shadow. Transitions use 200ms spring.

### Step 43: Redesign the progress bar as a liquid fill
The docked progress bar should look like liquid filling a glass tube. The fill has a subtle wave animation on top (a sine-wave `clip-path` that oscillates), a gradient from accent to accent-2, and a slight inner glow.

### Step 44: Build the indeterminate shimmer as aurora borealis
When speed is unknown, the indeterminate bar uses a slow, sweeping cyan-to-indigo-to-purple gradient that moves like aurora borealis across the glass tube. Duration 3s, ease-in-out.

### Step 45: Redesign skeleton loaders as glass shimmers
Skeletons become ghostly glass panes with a shimmer that travels diagonally (not horizontally) like light moving across glass at sunset. The shimmer is a linear-gradient with white(0.08) at 45 degrees.

### Step 46: Add the glass badge/pill component
Count badges (instance count, notification dots) become small glass pills with a vibrant accent dot or number. They float above their parent with a 2px offset and subtle shadow.

### Step 47: Redesign the stage strip as a glass timeline
The create-instance stage strip becomes a horizontal row of glass pills connected by thin glass lines. Each completed stage shows a checkmark with a spring pop. The active stage has a pulsing glow.

### Step 48: Create the glass icon container
Every icon container (mod icon, instance icon) becomes a small glass square with rounded corners, a subtle inner shadow, and a 0.5px white highlight on top. Icons sit inside with 12px padding.

### Step 49: Add the glass filter chip system
Filter chips become small glass pills with a press animation. Active chips have an accent tint. The chip uses `backdrop-filter` so the content behind it is visible through the chip.

### Step 50: Build the glass avatar component
The avatar uses a rounded-rect cutout (not circle) filled with the skin head image. Behind the image, a subtle glass backdrop ensures the skin integrates with the UI. A tiny highlight line at the top edge catches light.

---

## Phase 4 — Typography & Iconography (Steps 51-60)

### Step 51: Replace the font stack with SF Pro
Use the San Francisco font family. On macOS, use `-apple-system`. On Windows, use a SF Pro substitute like Inter with SF-aligned metrics. Set `--font-sans: -apple-system, 'Inter', 'SF Pro Text', system-ui, sans-serif`. The weight scale shifts to match iOS: 400 (Regular), 500 (Medium), 590 (Semibold), 700 (Bold).

### Step 52: Implement iOS Dynamic Type sizing
Replace fixed pixel font sizes with a modular scale based on the iOS Dynamic Type scale: `--text-caption: 12px`, `--text-body: 15px`, `--text-headline: 17px`, `--text-title: 20px`, `--text-large-title: 28px`, `--text-extra-large: 34px`. Every text element maps to one of these.

### Step 53: Add the iOS-style letter-spacing system
iOS uses specific tracking values: `--tracking-default: 0`, `--tracking-tight: -0.02em` for headlines, `--tracking-wide: 0.04em` for captions/buttons. Apply these across the type system.

### Step 54: Replace all icons with SF Symbols–style glyphs
Redraw every inline SVG icon to match the SF Symbols design language: 2pt stroke weight, rounded caps and joins, consistent optical sizing. Use `stroke-linecap="round" stroke-linejoin="round"` everywhere. The icons should feel like they belong on iOS.

### Step 55: Add the dynamic icon weight on interaction
Icons change stroke weight on interaction: 2pt default, 2.5pt on hover, 1.8pt on press (makes them feel "heavier" when pressed — a subtle iOS trick). Use `stroke-width` transition with 100ms ease.

### Step 56: Implement the numbered badge system
Replace plain text numbers (instance count, mod downloads) with iOS-style rounded-rectangle badges. The badge has a glass background, monospace numbers (`--font-mono`), and `font-variant-numeric: tabular-nums` for alignment.

### Step 57: Add the typographic hierarchy for readability
Every view must have a clear reading hierarchy: large title → headline → body → caption. Each level uses the correct Dynamic Type size, weight, and tracking. No element should have inline font styles — everything uses token classes.

### Step 58: Build a rich text helper for dynamic labels
Create a helper function that takes a plain string and returns an iOS-styled label with proper hierarchy. For example, "247 results in 312ms" becomes a two-line layout: "247" (large, bold) + "results in 312ms" (caption, muted).

### Step 59: Add the monospace numbers for metrics
Speed, ETA, and percentage displays in the docked progress use tabular-nums monospace so digits don't jump around. Set `font-variant-numeric: tabular-nums lining-nums` on all `.dp-metrics` elements. Add a subtle glass background behind the numbers.

### Step 60: Create the truncation system with fade
Instead of ellipsis (...) for truncated text, use a CSS mask with a linear gradient: `mask-image: linear-gradient(to right, black 80%, transparent 100%)`. This creates a smooth fade-out that looks more premium than hard dots.

---

## Phase 5 — Motion & Fluidity (Steps 61-75)

### Step 61: Replace all CSS animations with spring-based timing
Every animation and transition currently uses cubic-bezier. Replace them with the iOS spring curves defined in Step 8. The key difference: springs naturally overshoot slightly, creating that premium iOS "alive" feeling.

### Step 62: Implement the smooth scroll deceleration
Replace `scroll-behavior: smooth` with a custom scroll physics: when the user flicks, the content continues scrolling with exponential decay. Use `overscroll-behavior-y: contain` with a rubber-band effect at boundaries.

### Step 63: Add the iOS list spring on item appear
When items appear in a list/grid, they spring up one by one with a 30ms cascade delay. Each item uses `animation: item-spring 500ms var(--ease-spring-snappy) both` with `translateY(12px) → translateY(0)` and a subtle scale.

### Step 64: Build the glass tilt effect on hover
When hovering over a glass card, apply a subtle 3D perspective tilt: the card rotates 1° on the X and Y axes based on mouse position. Use `transform: perspective(800px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y))` tracked via JS mousemove.

### Step 65: Add the fluid tab bar indicator
The bottom tab bar's active indicator (a small glowing pill) slides between tabs with a 500ms spring. The indicator's width animates to match the label width. This is the signature iOS tab bar animation.

### Step 66: Implement the view transition with depth
View transitions use a three-act choreography: (1) current view translates -20% and scales 0.95 with blur increase, (2) a 50ms pause, (3) new view translates from +30% to 0 with blur decrease. Total 450ms.

### Step 67: Add the pull-to-refresh gesture
On the Discover and Library views, add a pull-down gesture that reveals a glass spinner with "Pull to refresh" text. Past a threshold (80px), the text changes to "Release to refresh" with a haptic-like spring.

### Step 68: Build the shimmer as caught light
The shimmer animation (used in skeletons and progress) should look like a beam of light sweeping across irregular glass. Use a conic-gradient at 45 degrees, white with 0.12 opacity, and a 2.5s loop with `--ease-ios`.

### Step 69: Add the success celebration burst
When an instance is created or mods install successfully, replace the confetti with a glass shattering effect: 16 glass fragments (CSS clip-path polygons) that burst outward from the center with random rotation and spring trajectories.

### Step 70: Implement the breathing glass effect
Static glass surfaces (not hovered) subtly pulse with a 4-second cycle: opacity oscillates between 0.96 and 1.0, blur oscillates between 20px and 22px. This makes the glass feel alive, like it's responding to ambient light.

### Step 71: Add the magnetic snap for list items
When scrolling a list of instances, the nearest item to center magnetically snaps into focus with a subtle scale-up (1.02×). This is the iOS list focus effect. Use `IntersectionObserver` with a centered root margin.

### Step 72: Build the fluid Dynamic Island expansion
When a launch starts, the Dynamic Island expands from 120px to full width. The expansion has three phases: (1) width stretches with spring 500ms, (2) content fades in from below 300ms, (3) the progress bar liquid-fills from left 600ms.

### Step 73: Add the typing indicator animation
When the search input is focused, show a pulsing cursor that matches iOS: a vertical bar (2px wide, accent color) that fades in/out with a 1s cycle, not a block cursor.

### Step 74: Implement the glass distortion on drag
When dragging the modal sheet, the glass background distorts slightly: `backdrop-filter` blur decreases from 40px to 20px as the sheet is pulled down, creating a sense of the glass stretching.

### Step 75: Add the screen edge gesture hint
On the left edge of the screen, a subtle glass glow (2px wide, linear-gradient from accent to transparent) appears to hint at back-swipe gesture. Fades in after 200ms of inactivity on the edge.

---

## Phase 6 — Informative Loading & Feedback (Steps 76-85)

### Step 76: Redesign loading as a glass story
Loading states should tell a story: "Authenticating with Microsoft…" shows a pulsing glass shield icon with a brief 1-sentence explainer below it. "Downloading libraries…" shows a glass progress tube with file count. Each stage has a unique glass icon animation.

### Step 77: Build the atomic stage timeline
During launch, the docked progress should show a horizontal stage timeline: 6 connected glass pills (one per stage). The current stage pill pulses, completed stages have a checkmark, and future stages are dimmed. Users can see exactly where they are in the 6-stage process.

### Step 78: Add the per-file glass card animation
When downloading, each file appears as a small glass card that slides up, shows its name for a moment, then slides out. This gives the user a real-time sense of what's happening. Batch updates to 3 visible cards max to avoid visual noise.

### Step 79: Implement the speed gauge display
Replace plain text speed with a miniature analog gauge: a 180-degree arc with a glass needle that sweeps from left (0 MB/s) to right (max observed speed). The gauge updates with spring interpolation.

### Step 80: Create the ETA countdown ring
Around the percentage number, add a circular ring that fills counter-clockwise as ETA decreases. When ETA is unknown, the ring shows an indeterminate pulsing glow. The ring uses `stroke-dasharray` with a 600ms spring transition.

### Step 81: Add the contextual tip system
When waiting more than 3 seconds on any stage, show a rotating set of contextual tips in a glass pill below the progress: "Did you know? Fabric loads mods 40% faster than Forge." Each tip slides in from the right with a 400ms ease.

### Step 82: Build the launch readiness indicator
Before clicking Play, show a small glass summary card: "Ready to launch: 2.4 GB memory, Java 17, 12 mods loaded." This gives users confidence before they commit to launching.

### Step 83: Add the post-launch activity pill
After launching, the Dynamic Island shrinks to a small "Playing [instance name]" pill with a pulsing green dot. Clicking the pill brings focus back to Minecraft's window. This mimics iOS's background activity indicator.

### Step 84: Implement the idle state ambient animation
When the launcher is idle for more than 10 seconds, the background gradient slowly drifts (600s loop) and glass highlights subtly shift position. The app should feel alive even when doing nothing.

### Step 85: Build the error recovery flow
When a launch fails, show a detailed glass error card with: error icon (vibrant red glass), error message (human-readable), a "Try Again" button (glass pill), and a "View Logs" link. No more cryptic error messages.

---

## Phase 7 — Views & Pages (Steps 86-95)

### Step 86: Redesign the Home page as a widget dashboard
The home page is now a iOS-style widget grid: a large hero widget (2 columns × 2 rows) showing "Continue Playing" with the last-played instance art, followed by 2×1 "Recent" widget, and 2×1 "Library Summary" widget. Each widget is a glass pane with distinct depth.

### Step 87: Build the Discover page as a glass storefront
The discover page gets a hero search banner: a full-width glass panel with a large centered search field, category chips below it (glass pills), and a results grid below. The filter sidebar slides in from the left as a glass sheet when tapping a filter button.

### Step 88: Redesign the Library as a glass album grid
The library becomes a grid of glass album covers: each instance gets a large-format glass card with the initial letter as a massive glyph (80px) behind a glass tint. The grid uses 3 columns with `minmax(280px, 1fr)`.

### Step 89: Build the Instance Detail as a glass profile
The instance detail page becomes a vertical glass card stack: a hero card with instance name + stats, followed by tabbed content in glass panes. The Play button is a prominent glass pill at the bottom (sticky).

### Step 90: Redesign Settings as a glass list
Settings becomes a grouped table like iOS Settings: sections separated by glass dividers, each row is a glass surface with label on the left and control on the right. Categories in the sidebar are glass pills.

### Step 91: Create the Mod Detail modal as a glass product card
The mod detail modal is a bottom sheet with: mod icon (glass cutout), title, stats (downloads, follows), description in iOS body text, version list as glass chips, and install button as a prominent glass pill.

### Step 92: Build the Create Instance flow as a glass wizard
The create flow is a multi-step bottom sheet: Step 1 "Choose Profile" (glass card grid), Step 2 "Configure" (glass form), Step 3 "Review & Create" (glass summary). A glass stage strip at the top shows progress.

### Step 93: Redesign the command palette as a glass spotlight
Cmd+K opens a glass overlay with a large centered search field, results as glass items with icons. The overlay uses visionOS-style glass: extreme blur (80px), no visible border, items float with shadow.

### Step 94: Add the empty state as a glass placeholder
Empty states show a large glass icon (120px, frosted circle) with centered text and a glass "Get Started" button. The empty state feels intentional and premium, not like a bug.

### Step 95: Create the onboarding glass sequence
First-time users see a 3-step glass onboarding: (1) "Welcome to Pine Launcher" with glass wordmark animation, (2) "Sign in with Microsoft" with glass button, (3) "Create your first instance" with glass demo. Each step is a full-view glass pane with spring transitions.

---

## Phase 8 — Polish & Edge Cases (Steps 96-100)

### Step 96: Add the capacitive touch feedback simulation
On every interactive element, add a subtle `::after` that scales up on `:active` with a radial-gradient from the interaction point. This simulates iOS's capacitive touch highlight — a brief white flash that says "I felt that."

### Step 97: Implement the glass layer culling
When more than 5 glass layers overlap (e.g., modal on top of sheet on top of content), reduce the blur on deeper layers to save GPU. Use a class on the body for each open overlay and dynamically adjust `--blur-multiplier`.

### Step 98: Add the window chrome integration
Remove Electron's default window chrome. Build custom window controls (traffic lights on macOS, minimize/maximize/close on Windows) as glass pills in the top-left. The title bar is part of the Dynamic Island glass pane.

### Step 99: Performance budget for glass
Set a performance budget: no more than 8 concurrent backdrop-filter layers (GPUs have limits). Use `will-change: transform` on animated glass elements. Detect low-GPU environments and fall back to tint-only glass (no blur).

### Step 100: Final visual audit against iOS 18 HIG
Go through every screen and compare against Apple's Human Interface Guidelines for iOS 18. Check: the status bar respects safe areas, touch targets are 44×44pt minimum, text uses Dynamic Type sizes, the glass consistently feels like real glass, all animations joyfully spring.
