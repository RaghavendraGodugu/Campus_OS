# CampusOS — palette studies

Six palettes that fit the product as it now exists: a data-dense college
platform with a liquid-glass surface, a dark navigation rail, status badges in
four hues, and a light/dark theme.

Every study keeps the same **four roles**, because that is what the component
library is built around:

| Role | What it paints |
| --- | --- |
| **Brand** | sidebar rail, primary buttons, links, focus rings |
| **Canvas** | the page behind everything |
| **Surface** | cards, inputs, menus — one step lighter than the canvas |
| **Accent** | chips, glows, the pale fill behind emphasis |
| **Pop** | one saturated mark: a dot, an icon, a progress end. Never text. |

The status colours (emerald success, amber pending, red danger, sky info) stay
as they are. None of these palettes introduces a fifth hue into a badge.

> Live preview: **http://localhost:5173/palettes.html** — the same six side by
> side, with the mini interface above each swatch row.

---

## At a glance

| # | Name | Brand | Canvas | Surface | Accent | Pop | Ink |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Midnight Indigo / Vanilla | `#282B4A` | `#EEEBDA` | `#FCFAF4` | `#E6E1CF` | `#6E74A8` | `#171824` |
| 2 | Oxblood / Parchment | `#4A1F24` | `#F1E7D6` | `#FAF4E8` | `#ECD9BA` | `#B08D57` | `#2B1A1C` |
| 3 | Deep Teal / Chalk | `#0C3B3A` | `#E9E7DE` | `#F7F6F1` | `#DBE7DF` | `#C97B63` | `#14211F` |
| 4 | Graphite / Acid | `#1C1D21` | `#EDECE6` | `#F8F7F2` | `#E5E4DA` | `#B6E33F` | `#141518` |
| 5 | Ink Blue / Apricot | `#14243A` | `#F2E9DC` | `#FBF5EC` | `#F1DFC9` | `#E8A87C` | `#17222F` |
| 6 | Plum / Powder | `#3A2340` | `#F0E9EE` | `#FAF6F8` | `#EADFE6` | `#C98B9B` | `#241A26` |

---

## 1 · Midnight Indigo / Vanilla — *installed*

**Brand** `#282B4A` · **Canvas** `#EEEBDA` · **Surface** `#FCFAF4` · **Accent** `#E6E1CF` · **Pop** `#6E74A8`

A dark, slightly violet navy on a warm cream. The vanilla is what stops the
indigo from reading as "bank website": the rail is formal, the page is paper.
The periwinkle pop is the only cool note in the light theme.

**Best for:** the safest premium option. Reads institutional without being
stuffy, and photographs well in screenshots.
**Watch:** the periwinkle pop is weak on cream (3.7:1) — use it as a dot or a
fill, not as link text.

---

## 2 · Oxblood / Parchment

**Brand** `#4A1F24` · **Canvas** `#F1E7D6` · **Surface** `#FAF4E8` · **Accent** `#ECD9BA` · **Pop** `#B08D57`

Deep wine on old paper, with brass. This is the "old university" palette — the
one that feels like a registrar's office that has been there for a century.
Brass reads as a seal or a rule, never as a button.

**Best for:** prestige. Convocation, certificates, transcripts, a brand that
wants to feel older and more serious than its competitors.
**Watch:** red is also the danger hue. Keep the brand oxblood away from
destructive actions — the danger button must stay the brighter red.

---

## 3 · Deep Teal / Chalk

**Brand** `#0C3B3A` · **Canvas** `#E9E7DE` · **Surface** `#F7F6F1` · **Accent** `#DBE7DF` · **Pop** `#C97B63`

Teal reads as competence and care at the same time; chalk keeps it quiet.
Terracotta is the warmth that stops it becoming a hospital dashboard.

**Best for:** trust — finance, health, counselling, grievance handling. The
calmest of the six under a dense table.
**Watch:** teal and emerald success are adjacent. Give the success badge a
lighter tint than the brand, as the current code already does.

---

## 4 · Graphite / Acid

**Brand** `#1C1D21` · **Canvas** `#EDECE6` · **Surface** `#F8F7F2` · **Accent** `#E5E4DA` · **Pop** `#B6E33F`

Near-black rail, warm grey page, one electric lime signal. This is the palette
that leans hardest into liquid morphism: the glass cards and the sheen do the
work, and the lime is the only thing allowed to shout.

**Best for:** a young, product-led brand; a landing page; a demo that needs to
look contemporary in a screenshot.
**Watch:** the lime must never be text on cream (1.3:1). Fills, dots, chart
lines on dark only. And it is close to the success green — do not put a lime
mark next to a "Paid" badge.

---

## 5 · Ink Blue / Apricot

**Brand** `#14243A` · **Canvas** `#F2E9DC` · **Surface** `#FBF5EC` · **Accent** `#F1DFC9` · **Pop** `#E8A87C`

A softer navy than indigo, on a warmer cream, with apricot for warmth. This is
the friendliest of the six and the most student-facing.

**Best for:** students as the primary audience — requests, certificates, fees.
Less "administration", more "services".
**Watch:** apricot on cream is weak (1.7:1); it works as a large soft glow or a
filled chip, not as an outline.

---

## 6 · Plum / Powder

**Brand** `#3A2340` · **Canvas** `#F0E9EE` · **Surface** `#FAF6F8` · **Accent** `#EADFE6` · **Pop** `#C98B9B`

Plum on a faintly pink paper with a dusty rose mark. The most distinctive and
the least generic; it will be remembered, which is not the same as being
trusted instantly.

**Best for:** a brand with a point of view — arts, design, a college that is not
trying to look like every other college.
**Watch:** it is the only study where the canvas is cool. The dark theme needs
its own rose desaturation or it turns mauve.

---

## Contrast check

Text pairs only. The pop colour is measured for information, not as a text
colour.

| Palette | White on brand | Ink on canvas | Brand on accent |
| --- | ---: | ---: | ---: |
| Midnight Indigo / Vanilla | 13.68 | 14.70 | 10.45 |
| Oxblood / Parchment | 13.88 | 13.53 | 10.05 |
| Deep Teal / Chalk | 12.34 | 13.38 | 9.70 |
| Graphite / Acid | 16.84 | 15.42 | 13.18 |
| Ink Blue / Apricot | 15.63 | 13.37 | 12.02 |
| Plum / Powder | 14.05 | 14.07 | 10.84 |

All six clear AA and AAA for body text. The differences between them are
temperature and personality, not legibility.

---

## Applying one

The theme is fully tokenised, so a palette is six values and one dark-mode
override — no component changes.

In `campusOs_frontend/src/index.css`, `@theme`:

```css
--color-brand-600: <brand>;      /* primary action, focus ring */
--color-brand-ink: <brand dark>; /* sidebar rail */
--color-canvas:    <canvas>;
--color-surface:   <surface>;
--color-ink-800:   <ink>;        /* body text */
--color-ink-400:   <muted>;      /* secondary text */
--color-accent-200:<accent>;     /* chips, pale panels */
--color-accent-400:<pop>;        /* the warning-free accent mark */
```

Then two derived ranges need regenerating: the light steps of `brand` (they
tint chips and borders) and the dark-mode `brand` lift (a dark rail on a dark
canvas vanishes otherwise). That is what I would do when installing one.

---

## The pick

- **Extraordinary, still institutional:** **#2 Oxblood / Parchment.** It is the
  only one that changes how the product feels rather than how it is painted.
- **Best all-rounder:** **#3 Deep Teal / Chalk.** Calm under data, warm enough
  not to be cold, and the least likely to date.
- **Best fit for liquid morphism:** **#4 Graphite / Acid.** The glass and the
  sheen read strongest against near-black and a single acid signal.
- **Keep if you want safe:** **#1**, already installed.

If you want, I can install any one of these end to end — regenerate the full
ramp, lift it for dark mode, re-check contrast, and rebuild.
