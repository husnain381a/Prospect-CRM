# Prospect CRM interface

The workspace is a professional, readable light interface. Purple identifies primary actions and selection; slate text, white cards, and a soft gray canvas keep business information prominent. The UI/UX Pro guidance for flat application interfaces, visible keyboard focus, contrast, and reflow informed this system. Marketing layouts from the general design-system search do not apply to the CRM.

## Typography

- Self-hosted Inter variable, with Segoe UI and sans-serif fallbacks. Font display swaps; the font and its OFL license are included in public/fonts.
- Page titles: 28–34px, weight 700. Card headings: 17–18px, weight 600–650.
- Main descriptions: 15px. Table content, navigation, and controls: 14px. Supporting labels: 12–13px.
- Compact uppercase section markers: 11px. Never reduce content size at a responsive breakpoint.
- Form inputs on phones: 16px. Paragraph line height: 1.6. Numeric metrics use tabular figures.

## Color and surfaces

Use semantic CSS tokens in app/globals.css: foreground #202536, muted #596174, background #f5f6fa, border #dfe3ec, primary #6941c6, green #18704d, orange #915514, danger #b42335. Status labels always include text. Use white cards with 12px corners, restrained shadows, and clear borders. Avoid low-contrast pastel text.

## Navigation and layout

- Desktop at 1024px and above: 256px sidebar with a scrolling middle section. Brand and account controls remain outside that scroll area.
- Below 1024px: Radix modal navigation drawer with Escape, focus trapping, focus return, and a visible close button. Close when selecting a destination or returning to desktop width.
- 1280px and above: four summary cards. Smaller screens: two columns, then one on the smallest phones.
- Below 768px: leads become labeled business cards. All lead information and Google profile links stay available. Forms stack to one column.
- Pipeline columns scroll inside their own labeled keyboard-focusable region. Other pages must not cause document-wide horizontal overflow.
- Primary controls are at least 44px tall; compact desktop actions may be 32–40px. Touch layouts enlarge compact actions.

## Interaction and content

Preserve working CRM actions, permissions, real data loading, and existing channels. Mark selected filters with aria-pressed and current navigation with aria-current. Provide a skip link, visible focus rings, accessible dialog names, and reduced-motion support. Do not add sample data or decorative trend graphs that could be mistaken for actual metrics. Unassigned owners are labeled explicitly.
