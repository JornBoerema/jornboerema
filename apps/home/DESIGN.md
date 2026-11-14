---
name: Even
description: The Even website as an opened ring binder; flat coloured divider sheets, white punched paper, a black cover.
colors:
  orange: "#f07a2b"
  orange-deep: "#b84f0c"
  ink: "#17140f"
  paper: "#fffdf8"
  blue: "#2a57d6"
  yellow: "#f6c62e"
  green: "#17794f"
typography:
  display-hero:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(3.6rem, 9.4vw, 8.5rem)"
    fontWeight: 800
    lineHeight: 0.88
    letterSpacing: "-0.04em"
    fontVariation: "'wdth' 82"
  display:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(2.6rem, 6.4vw, 5.5rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
    fontVariation: "'wdth' 82"
  title:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1.1rem, 1.6vw, 1.35rem)"
    fontWeight: 700
    lineHeight: 1.25
  lead:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1.1rem, 1.5vw, 1.3rem)"
    fontWeight: 420
    lineHeight: 1.45
  body:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 420
    lineHeight: 1.55
  button:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    fontVariation: "'wdth' 92"
  label:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.35
  small:
    fontFamily: "Archivo, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 600
rounded:
  label: "3px"
  control: "6px"
  tab: "10px"
  round: "50%"
spacing:
  gutter: "24px"
  hole-margin: "56px"
  sheet-pad: "clamp(24px, 6vw, 96px)"
  rail: "60px"
  rail-wide: "88px"
  rail-narrow: "58px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "17px 26px"
  button-on-dark:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "17px 26px"
  button-cover:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "17px 26px"
  tab:
    typography: "{typography.label}"
    rounded: "{rounded.tab}"
    width: "40px"
  tab-hover:
    width: "48px"
  tab-current:
    width: "54px"
  key:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "30px"
    padding: "0 7px"
  key-pressed:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "30px 32px 32px"
  spine:
    rounded: "7px 7px 0 0"
    padding: "12px 10px 18px"
    height: "clamp(250px, 30vw, 340px)"
  spine-label:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.label}"
    padding: "10px 9px 12px"
  switch-option-checked:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    padding: "7px 14px"
---

# Design System: Even

## Overview

**Creative North Star: "De ordner"**

The site is an opened ring binder, the entrepreneur's own administration. Every section is a divider sheet in one flat colour that runs edge to edge, with two punched holes on its left and its tab on the black rail beside it. White punched sheets lie on top of the dividers and carry the things you can read closely or operate: an example inbox, a price. The black of the binder's cover shows wherever no sheet is: the rail, the page behind the sheets, the last section.

It is dense in colour and sparse in parts. A divider holds one claim in heavy condensed lettering, a short explanation, and at most one black button. Structure is drawn with thick black rules, as on a printed form, and with the sheets themselves; there are no boxes inside boxes. Movement follows gravity: sheets drop in from above once, a filed mail slides off towards the tabs, and nothing else moves on its own.

The build refuses gradients, glass and rows of cards with icons. The one exception is the Even icon, a fixed brand asset that carries its own gradient.

**Key Characteristics:**
- One flat saturated colour per section, edge to edge, text colour set by the sheet.
- One type family, Archivo, with weight and width doing all the hierarchy.
- Thick black rules (2px) for lists, tables and footers.
- A fixed column of tabs as navigation; the tab of the current sheet sticks out further.
- White paper sheets, slightly turned, as the only raised objects.
- Motion is dropping and sliding, eased out, and switches off under reduced motion.

## Colors

Five divider colours and two papers: saturated, flat, and never blended into one another.

### Primary
- **Even Orange** (`orange`): The brand colour and the first divider. Also the home download page ground, the trial button on the black cover, the full stop in the closing wordmark, list markers, the text caret, and the holes of a white sheet lying on orange. Carries ink text.
- **Deep Orange** (`orange-deep`): Orange for text on white paper only (the inbox count). Plain orange on paper is 2.75:1; this one is 4.96:1.

### Secondary
- **Divider Blue** (`blue`): The privacy divider and the Even doen spine. Carries paper text.
- **Divider Yellow** (`yellow`): The "included" divider, the highlight on the current mail in the example inbox, the ring on a binder spine, and text selection on ink. Carries ink text.
- **Divider Green** (`green`): The price divider and the Even noteren spine. Carries paper text.

### Neutral
- **Cover Black** (`ink`): All text on light sheets, all rules, the primary button, the rail, the closing section, the punched holes of a divider (the cover showing through), and the page behind everything.
- **Sheet White** (`paper`): White dividers, loose sheets, spine labels, text on blue, green and black. Slightly warm, never pure white.
- **Soft text and soft rule**: not fixed colours. Each sheet mixes them from its own text and ground with `color-mix`: soft text is 78% text colour on a coloured divider, 70–72% on paper, 92% paper on blue and green, 68% paper on the cover; the soft rule is 16% ink on paper and 22% on a coloured divider.

### Named Rules
**The Sheet Sets The Text Rule.** Every surface declares its ground (`--sheet`) and its text (`--fg`) together. Orange, yellow and paper take ink; blue, green and black take paper. Soft text is always a mix of those two, declared on the sheet itself, never a grey carried over from another sheet.

**The Flat Ground Rule.** A sheet is one colour from edge to edge. No gradients, no tints of a divider colour, no translucent layers.

**The Deep Orange Rule.** Orange as text on paper is always `orange-deep`. Plain orange is a ground, a mark or a button, never small text on white.

## Typography

**Display Font:** Archivo variable (with Helvetica Neue, Helvetica, Arial, sans-serif), self-hosted, weight 100–900, width 62–125%
**Body Font:** the same family at normal width

**Character:** One heavy grotesque for lettering, narrowed and set tight so a claim reads like a stamped binder label; the same family, lighter and at full width, for reading. There is no second face and no monospace.

### Hierarchy
- **Display hero** (800, width 82%, `clamp(3.6rem, 9.4vw, 8.5rem)`, line-height 0.88, -0.04em): the one headline of the first divider, held to about 7 characters a line. On narrow screens `clamp(3.2rem, 16.5vw, 6rem)` and free to wrap.
- **Display** (800, width 82%, `clamp(2.6rem, 6.4vw, 5.5rem)`, line-height 0.95, -0.035em, word-spacing 0.08em, balanced): the claim of each divider, at most 14 characters a line. The same style scales up for numerals and the closing wordmark (price `clamp(5rem, 9vw, 7.5rem)`, wordmark `clamp(5rem, 15vw, 13rem)`), and down for a sheet title (30px) and plain-page titles (`clamp(40px, 7vw, 64px)`).
- **Title** (700, `clamp(1.1rem, 1.6vw, 1.35rem)`, line-height 1.25): questions and index rows (index rows at 600).
- **Lead** (420, `clamp(1.1rem, 1.5vw, 1.3rem)`, line-height 1.45, max 34rem): the one explanation under a claim.
- **Body** (420, 17px, line-height 1.55): running text. Long-form prose on the plain pages is 16px at 1.7, max 40rem.
- **Button** (700, width 92%, 19px): the action label.
- **Label** (600–750, 15px): tab labels (650, width 88%), key legends (750), inline links, switch options.
- **Small** (600–650, 13px): times, the "example" mark, spine states. Numbers that change use tabular figures.

### Named Rules
**The One Family Rule.** Archivo only. Hierarchy comes from weight (420 to 800) and width (76% to 100%); a second typeface is never the answer.

**The Narrow Is For Lettering Rule.** Width below 100% belongs to display type, buttons, tabs and spine labels. Text meant to be read in sentences stays at full width.

## Layout

The page is a stack of full-width dividers beside a fixed rail. On the home page the rail is the binder's cover showing at the right edge (`rail` 60px, `rail-wide` 88px from 1200px), and the binder takes the rest. Each divider pads its content by `sheet-pad` on both sides plus a `hole-margin` (56px) on the left for the punched holes, with `clamp(72px, 12vh, 136px)` above and `clamp(80px, 13vh, 152px)` below. Grounds run edge to edge; content stops at 1280px.

Inside a divider the composition is one column of lettering, or lettering beside one object: headline and inbox sheet (`1fr` / max 470px), index list and plain list (1.15 / 1), claim and price sheet (`1fr` / max 420px), three claims in equal columns, six binder spines on a shelf (max 940px). The first divider fills the viewport. Vertical gaps between a claim and what follows scale with viewport height (`clamp(40px, 7vh, 72px)`).

Below 860px the rail lies along the bottom (`rail-narrow` 58px) and the tabs hang down from the page, written horizontally; the hole margin closes and the holes shrink to 12px at the edge; every two-column composition becomes one column; the shelf becomes two rows of three, each on its own shelf line. Below 420px only paddings tighten.

The plain pages (privacy, terms, download) are a single sheet: a centred column of 26rem, or 40rem when it holds prose, with a 24px gutter.

## Elevation & Depth

Flat by default. Depth comes from things lying on each other, and only two things do: a white sheet on a divider, and one divider on the next.

### Shadow Vocabulary
- **Loose sheet** (`box-shadow: 0 22px 44px -18px color-mix(in srgb, var(--ink) 55%, transparent)`): under a white paper sheet lying on a divider. Soft, pulled in, below only.
- **Sheet overlap** (`box-shadow: inset 0 16px 18px -18px color-mix(in srgb, var(--ink) 60%, transparent)`): a little shade along the top of every divider after the first, where the previous sheet lies over it.
- **Cover outline** (`box-shadow: inset 0 0 0 2px var(--paper)`): not a shadow; the last tab drawn in outline because it is black on the black rail. The brand icon carries the same kind of ring in ink (`0 0 0 2px`).

### Named Rules
**The Only Paper Lifts Rule.** A shadow means a sheet of paper is lying on something. Buttons, tabs, spines and lists cast none; a button answers hover by moving 2px up, not by gaining a shadow.

## Shapes

Paper is cut square: dividers, loose sheets and rules have no radius. Rounding marks things that are handled. Tabs are rounded on their two outer corners only (`tab` 10px, 13px on wide screens, 9px hanging on narrow ones); binder spines on their top corners (7px); buttons, keys and small switches all round (`control` 6px); the paper label on a spine barely (`label` 3px). Holes and rings are true circles: 24px holes on a divider at about a fifth from top and bottom, 18px on a loose sheet, a 34px ring with a 5px paper border on a spine.

Lines are thick and black: 2px ink for list rows, footers and outlined controls, 6px for the shelf. The 1px soft rule is reserved for secondary lists. Things not built yet are drawn in 2px dashed ink with no fill. A loose sheet is turned slightly (1.6° and -1.2° in the build, about half that on narrow screens); dividers never turn.

## Components

### Buttons
The one action of a sheet, solid and heavy.
- **Shape:** gently rounded (6px), padding 17px 26px, no border, no shadow.
- **Primary:** ink ground, paper label, on orange, yellow and paper.
- **On dark sheets:** paper ground with ink label on blue and green; orange ground with ink label on the black cover.
- **Hover / Active:** lifts 2px, presses 1px down; 0.25s ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Quiet link:** beside or under the button; soft text, 16px at weight 550, underlined 2px with a 4px offset, turning to full text colour on hover.
- **Download button (plain pages):** the same black button stretched to the column, label left and file detail right in orange.

### Tabs (navigation)
The page's ruler: the same column on every section.
- **Style:** one tab per section in that section's colour and text colour, label written vertically (15px, weight 650, width 88%; 19px from 1200px), 6px apart, centred on the rail.
- **States:** 40px wide at rest, 48px on hover, 54px for the current section with weight 800 (60 / 68 / 78px from 1200px). State is length only; a tab never changes colour.
- **Cover tab:** the last one, black with a 2px paper outline.
- **Receiving:** when the example inbox files a mail, the Mail tab extends further for 420ms.
- **Narrow screens:** a bottom bar of equal tabs hanging from the page, 44px tall, 52px when current, labels horizontal.

### Loose sheet
A white punched sheet lying on a divider; the only raised object.
- **Style:** paper ground, ink text, square corners, the loose-sheet shadow, a slight turn. Padding 30px 32px 32px, or 30px 30px 26px 62px when it shows its two holes.
- **Holes:** two circles on the left in the colour of the divider underneath.
- **Contents:** rows separated by 2px ink rules, a sheet title in display type, one button at full width if it sells.
- **Entrance:** drops 34px from above once when it first comes into view (0.7s ease-out), 60ms apart within a row.

### Keys
- **Style:** a 30px square with a 2px outline in the current text colour, 6px radius, the legend at 15px weight 750. Two keys sit 5px apart for a combination.
- **As a control:** key plus word; on hover or press the key fills with ink and moves 2px down.

### Ruled lists
- **Style:** each row between 2px ink rules, top and bottom closed; 10–13px vertical padding. Used for the mail rows, the key index, what the plan includes, and the questions.
- **Current row:** a yellow ground that reaches 12px past the rules on both sides.
- **Questions:** native disclosure rows; the marker is two 18px by 3px ink bars forming a plus, one of which turns flat when open (0.3s).
- **Filing:** a row slides off to the right (or drops, when snoozed) in 0.42s, then its row closes in 0.34s; the sheet keeps its height.

### Binder spines
- **Style:** an upright block in a divider colour standing on a 6px ink shelf, top corners 7px; a paper label with "Even" small and the app name in narrow display type; a state line; a yellow ring with a paper border at the foot.
- **Hover:** a linked spine pulls 14px up off the shelf (0.4s).
- **Not built yet:** no fill, 2px dashed ink outline, outlined label and dashed ring, no link.

### Two-way switch
- **Style:** two options in one 2px ink outline; the chosen one is filled ink with paper text (15px, weight 650, padding 7px 14px). The language switch is the same outline at 13px weight 750 with 0.04em tracking.

### Plain page
- **Style:** a breadcrumb line (15px, soft, the home link in ink at 650), a display title, a soft intro, then prose or one download button, closed by a footer above a 2px ink rule. Prose headings are display type at 24px; list markers are orange; links underline 2px and the underline turns orange on hover.

### Focus
- **Style:** a 3px solid outline, 3px off the element, in ink on light sheets and in paper on blue, green and the cover.

## Do's and Don'ts

### Do:
- **Do** give every new section its own divider: one flat colour edge to edge, two holes on the left, a tab on the rail in the same colour.
- **Do** set `--sheet` and `--fg` together on any new surface and mix its soft text from those two on that same surface.
- **Do** keep one claim, one short explanation and at most one black button per divider.
- **Do** draw structure with 2px ink rules and with sheets; put anything that must look like an object on a white loose sheet.
- **Do** use Archivo for everything; narrow it (76–92%) for lettering, tabs, buttons and labels, and leave reading text at full width.
- **Do** show state by length or position: a tab sticks out, a spine lifts, a key goes down.
- **Do** let things enter by dropping from above and leave by sliding off, with `cubic-bezier(0.16, 1, 0.3, 1)`, and keep the reduced-motion switch that turns all of it off.
- **Do** mark any made-up content shown as a demonstration as an example, on the sheet itself.

### Don't:
- **Don't** use gradients, glass, blur or translucent panels on any sheet. The Even icon is the single exception and stays as it is.
- **Don't** build a row of cards with icons; a list is ruled rows, a set of products is spines on a shelf.
- **Don't** set plain orange as text on paper; use deep orange.
- **Don't** put a shadow on anything but a white sheet lying on a divider, and never a hard offset one.
- **Don't** round the corners of a divider or a loose sheet; paper is cut square.
- **Don't** add a second typeface or a monospace, not even for keys.
- **Don't** change a tab's colour to show state, and don't turn the tab column into a different kind of menu on small screens; a tab stays a tab.
- **Don't** blend two divider colours on one sheet or invent a sixth divider colour without a section to file under it.
