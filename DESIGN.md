# Context Window Inspector Design System

## Direction

Technical context instrument on a warm mineral canvas: near-black ink, hairline geometry,
monospaced labels, large areas of deliberate empty space, and a single cobalt point that identifies
the active request. The interface borrows the clarity of a scientific diagram without pretending
that the data is a simulation.

## Color strategy

Mostly monochrome product shell with one electric-blue focus color and a muted, named
visualization palette. Inside the context window, every category uses its own tinted sediment
layer while retaining a distinct pattern. The corresponding source icon, boundary node, and moving
packet repeat that color. Category color is always paired with a text label and geometric pattern.

```css
--bg: oklch(0.965 0.012 90);
--surface: oklch(0.982 0.007 90);
--surface-strong: oklch(0.925 0.012 90);
--ink: oklch(0.27 0.012 90);
--ink-soft: oklch(0.48 0.012 90);
--line: oklch(0.84 0.012 90);
--primary: oklch(0.59 0.22 270);
--primary-dark: oklch(0.45 0.20 270);
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

Use the system monospace stack for the title, labels, controls, metrics, paths, commands, and event
details. Use the system sans stack only for explanatory prose. Uppercase technical labels use
moderate tracking; prose remains sentence case. Keep the scale compact and fixed.

## Layout

- Compact sticky instrument header with session identity and local-only reassurance.
- Technical title block with a muted explanatory suffix and small context-engineering label.
- Session and model-request dropdowns form one compact selection group.
- Request facts appear as one continuous measurement strip, not metric cards.
- Composition centers on an all-source flow instrument with a cobalt active-request marker.
- Every non-zero category receives a labeled source, ordered across two sides to keep the paths
  readable when all nine categories are present.
- The circle fills from the bottom with patterned category sediment scaled to reported context
  capacity; the complete category ledger remains directly below it.
- Turn history is a full-width field of narrow instrument bars.
- Context items use small colored nodes, hairline rules, and a dense readable ledger.
- On narrow screens, all regions become a single column and the item filters become horizontal.

## Components

- Automatic local-session discovery with a manual multi-file fallback
- Session selector and request/turn selector
- Animated all-source context flow and patterned capacity sediment
- Pause and replay controls for the illustrative packet motion
- Turn timeline with category stacks
- Category filter chips
- Context item rows with source turn, estimate, preview, and explanation
- Optional retention lens toggle
- Methodology disclosure

## Motion

Categories animate as one deterministic sequence, ordered by token contribution. A single packet
travels from one source through the context-window boundary to the selected request. Only after it
arrives does that category's colored, patterned sediment layer grow; the next category waits until
the layer finishes. Each packet runs once and the completed diagram remains static. Pause and
replay govern the shared sequence. Category values, layer heights, and final sediment depth are
data-driven. Use 160–220ms ease-out transitions for selection and disclosure. Under reduced
motion, packets are hidden, the final sediment state is shown immediately, and motion controls are
disabled.
