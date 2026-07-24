# Context Window Inspector Design System

## Direction

Quiet laboratory instrument under neutral daylight: crisp white surfaces, fine measurement rules, dense but breathable information, and oxidized teal reserved for selection and orientation.

## Color strategy

Restrained product shell with a full, named visualization palette. Category color is always paired with a text label or pattern cue.

```css
--bg: oklch(1 0 0);
--surface: oklch(0.975 0.004 180);
--surface-strong: oklch(0.945 0.007 180);
--ink: oklch(0.19 0.018 210);
--ink-soft: oklch(0.43 0.018 210);
--line: oklch(0.88 0.008 200);
--primary: oklch(0.55 0.095 180);
--primary-dark: oklch(0.38 0.075 180);
--accent: oklch(0.62 0.16 48);
```

Visualization roles:

- System and tools: neutral slate
- Conversation: patina teal
- File contents: clear blue
- Searches: amber
- Commands: clay orange
- Code changes: violet
- Images: rose
- Reasoning: indigo
- Unresolved reconstruction: pale neutral with a dotted pattern

## Typography

Use the system sans stack for interface text and the system monospace stack for tokens, paths, commands, and raw event details. Keep the scale compact and fixed: 12px metadata, 14px body, 16–18px section headings, and a 28px page title maximum.

## Layout

- Sticky product header with session identity and local-only reassurance.
- Compact request facts strip, not oversized metric cards.
- Composition overview pairs one ring visualization with a labeled breakdown.
- Turn timeline spans the full content width.
- Context item explorer uses a stable filter rail and a dense, readable list.
- On narrow screens, all regions become a single column and the item filters become horizontal.

## Components

- File drop control with keyboard-accessible file input
- Request/turn selector
- Composition ring and stacked bar
- Turn timeline with category stacks
- Category filter chips
- Context item rows with source turn, estimate, preview, and explanation
- Optional retention lens toggle
- Methodology disclosure

## Motion

Use 160–220ms ease-out transitions for selection, disclosure, and chart updates. No entrance choreography. Under reduced motion, update state instantly.
