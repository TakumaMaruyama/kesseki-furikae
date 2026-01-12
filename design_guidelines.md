# 水泳教室振替予約システム - デザインガイドライン

## Design Approach

**Selected Approach**: Design System (Material Design 3 inspired)

**Justification**: This is a data-rich administrative application requiring clear information hierarchy, efficient form interactions, and status-driven UI. The Japanese user base expects clean, functional interfaces with clear visual feedback. Material Design principles provide excellent guidance for data-dense applications while maintaining accessibility.

**Key Design Principles**:
- Information clarity over visual embellishment
- Immediate status recognition through iconography and typography
- Efficient task completion with minimal friction
- Mobile-responsive for parent access on-the-go

---

## Typography

**Font Family**: 
- Primary: Noto Sans JP (Google Fonts) - Excellent Japanese character support with modern, clean aesthetics
- Fallback: system-ui, sans-serif

**Type Scale**:
- Page Headers (H1): 32px / 2rem, weight 700
- Section Headers (H2): 24px / 1.5rem, weight 600
- Card Headers (H3): 20px / 1.25rem, weight 600
- Body Text: 16px / 1rem, weight 400
- Small Text (metadata): 14px / 0.875rem, weight 400
- Status Labels: 14px / 0.875rem, weight 600

**Line Height**: 1.6 for body text, 1.3 for headers

---

## Layout System

**Container Strategy**:
- Max-width: `max-w-6xl` for main content areas
- Form containers: `max-w-2xl` for focused input experiences
- Full-width tables on admin screens with horizontal scroll on mobile

**Spacing Primitives** (Tailwind units):
- Primary spacing set: **2, 4, 6, 8, 12, 16**
- Card padding: `p-6` (desktop), `p-4` (mobile)
- Section spacing: `py-12` (desktop), `py-8` (mobile)
- Form field gaps: `space-y-4`
- Button spacing: `px-6 py-3`
- Tight spacing (status chips, inline elements): `px-2 py-1`

**Grid Systems**:
- Search results: Single column on mobile, remains single column on desktop for clarity (no multi-column grid for class slots)
- Admin tables: Full-width responsive tables with fixed header
- Status indicators: Inline with text, not separate columns

---

## Component Library

### Navigation & Layout

**Header**:
- Fixed top navigation bar, height: `h-16`
- Logo/title aligned left
- Minimal navigation (保護者向け / 管理画面 links)
- Padding: `px-6`

**Parent Interface Layout**:
- Centered single-column layout
- Search form at top, results below
- Sticky header with site title

**Admin Interface Layout**:
- Tab navigation (確定一覧 / 待ち一覧)
- Tab bar: `border-b-2`, active tab with bottom border accent
- Content area with appropriate padding

### Forms

**Input Fields**:
- Border: `border-2`, rounded: `rounded-lg`
- Height: `h-12` for text inputs
- Focus state: Ring offset for accessibility
- Label above input, weight 600, margin-bottom: `mb-2`
- Error messages below input, small text

**Select Dropdowns**:
- Consistent with text inputs
- Clear chevron icon indicator
- Options list with adequate padding: `py-2 px-4`

**Date Picker**:
- Native date input with custom styling
- Clear icon button to reset

**Email Input** (Waitlist):
- Type="email" with validation
- Inline with waitlist button or above it on mobile

**Buttons**:
- Primary: Rounded `rounded-lg`, height `h-12`, padding `px-8`
- Secondary: Same dimensions, different visual treatment
- Icon buttons: Square `w-10 h-10`, centered icon
- Full-width on mobile for primary actions

### Data Display

**Class Slot Cards**:
- Border: `border-2`, rounded: `rounded-xl`
- Padding: `p-6`
- Subtle shadow for depth
- Vertical stack layout:
  - Status indicator (○△×) + status text at top (prominent)
  - Course label + class band (bold)
  - Date + time (medium weight)
  - Available slots / waitlist count
  - Action button at bottom

**Status Indicators**:
- Display as badge/chip: rounded-full, `px-3 py-1`
- Icon (○△×) + text inline
- ○ Available: Success treatment
- △ Limited: Warning treatment  
- × Waitlist: Neutral/info treatment

**Tables** (Admin):
- Striped rows for readability
- Fixed header on scroll
- Cell padding: `px-4 py-3`
- Column headers: weight 600, uppercase, letter-spacing: wider
- Compact mode on mobile with stacked cells

**Tabs** (Admin):
- Horizontal tab bar
- Active tab: bottom border accent, bolder weight
- Inactive tabs: lighter treatment
- Tab padding: `px-6 py-3`

### Feedback & States

**Loading States**:
- Spinner: Centered, appropriate size (24px-32px)
- Skeleton loading for tables and cards

**Empty States**:
- Centered icon + message
- Helpful text explaining why empty
- Action button if applicable

**Success Messages**:
- Toast notification: Fixed position (top-right)
- Auto-dismiss after 5 seconds
- Success icon + message

**Error Messages**:
- Inline for form validation
- Alert box for system errors
- Error icon + descriptive text

### Overlays

**Modal Dialogs** (if needed for confirmations):
- Centered overlay with backdrop
- Max-width: `max-w-md`
- Padding: `p-6`
- Close button (×) top-right
- Action buttons bottom-right

**Confirmation Emails HTML**:
- Simple single-column layout
- Logo/header at top
- Clear section dividers
- Large, prominent action buttons (参加する / 辞退する)
- Footer with contact info

---

## Responsive Behavior

**Breakpoints**:
- Mobile: < 768px (base tailwind)
- Tablet: 768px - 1024px (md)
- Desktop: > 1024px (lg)

**Mobile Adjustments**:
- Stack all form fields vertically
- Full-width buttons
- Collapsible sections for admin tables
- Larger tap targets (min 44px)

**Desktop Enhancements**:
- Form fields with labels side-by-side where appropriate
- Hover states for interactive elements
- More generous spacing

---

## Accessibility

- All form inputs have associated labels (not placeholders only)
- Focus indicators clearly visible on all interactive elements
- ARIA labels for icon-only buttons
- Sufficient contrast ratios throughout
- Keyboard navigation support for all interactions
- Screen reader friendly status announcements

---

## Images

**No hero images required** for this application. This is a functional tool focused on efficiency.

**Icon Usage**:
- Use **Heroicons** (outline style) via CDN
- Status icons: CheckCircle (○), ExclamationTriangle (△), Clock (×)
- Form icons: Calendar, User, Mail
- Admin icons: List, Users, Settings
- Consistent 20px-24px size for inline icons

---

## Animation Guidelines

**Minimal animations** to maintain focus on functionality:
- Smooth page transitions: 200ms ease
- Button hover: subtle scale or shadow shift
- Tab switching: fade transition 150ms
- Toast notifications: slide-in from top
- **No** decorative or scroll-triggered animations