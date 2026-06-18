// Component kit — the single home for ledzeppelin's reusable UI factories.
//
// Every reusable control lives here so the design language (one weight, gapless
// mosaic, filled-accent selection — see docs/design-language.md) is encoded once:
// factories own the class names, ui.css owns the appearance. Import from this barrel:
//   import { el, Field, Button, Section, Slider } from './kit/index.js';
//
// Rules: a component is `Name(primaryArg, value?, opts = {}) -> DOM node`; handlers
// are `on…` called with the semantic value (not a raw event); state stays with the
// caller. Components never read CSS variables in JS and never hard-code a colour /
// size / spacing — they emit a class and let the tokens resolve it.

// The primitive + the small field/select helpers stay in dom.js (the kit builds on
// it; re-exported here so consumers have one import).
export { el, field as Field, selectInput as Select, shiftDown, coarseSnap } from '../dom.js';
export { Slider } from './slider.js';
export { Section, SEC_OPEN } from './section.js';
export { NumInput, TextInput } from './field.js';
