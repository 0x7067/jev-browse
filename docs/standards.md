# Standards used by the observation layer

The snapshot prefers platform-computed semantics and normative spec tables over
keyword or class heuristics. Heuristics that remain exist only where no standard
signal exists; each is listed with its reason.

## Platform-computed semantics

- `Element.computedRole()` / `Element.computedName()` (Chromium feature, not yet
  default-shipped): used when present for widget-role gating and accessible
  names; the coded HTML-AAM tag→role table is the fallback.
- ARIA IDL reflection (shipped Chrome 81 / Safari 12.1): `ariaCurrent`,
  `ariaModal`, `ariaLive`, `ariaRequired` are read verbatim and exposed on
  actions (`current`, `required`) and state (`live_regions`) without token
  whitelists.
- `checkVisibility()` plus `[aria-hidden="true"]` / `[inert]` for visibility.
- CDP Network domain events are the authoritative in-flight request signal;
  `document.readyState`/`load` cover document + subresources only, and Resource
  Timing entries for XHR/fetch appear only after `responseEnd`, so pending→0 is
  the completion evidence for programmatic requests.

## Normative tables coded as constants

- HTML sequential link types: `rel` tokens (`next`, `prev`, `first`, `last`,
  `up`, `contents`, `index`, …) are exposed verbatim on link actions and as
  `page_links`; no whitelist filters them.
- ARIA landmark roles (`navigation`, `main`, `banner`, `contentinfo`,
  `complementary`, `search`, `form`, `region`) plus the HTML-AAM implicit
  tag→landmark mapping (`nav`, `main`, `header`, `footer`, `aside`,
  named `section`/`form`) produce the per-action `landmark` field.
- ARIA live-region roles (`status`, `alert`, `log`, `marquee`, `timer`) plus
  implicit `<output>`→`status` produce `live_regions`.
- Modals: native `<dialog open>:modal` plus explicit `role=dialog` /
  `role=alertdialog` with `ariaModal === 'true'` (ARIA dialog pattern).
- Accessible-name computation follows the accname/HTML-AAM order:
  `aria-labelledby` → `aria-label` → associated `<label>` → value/alt →
  content → `title` → `placeholder`.

## Pragmatic fallbacks (no standard signal exists)

- CAPTCHA/bot-challenge detection: vendor selectors and challenge phrases
  (`[data-sitekey]`, `.g-recaptcha`, "verify you are human", …). No standard
  marks a challenge wall.
- JS clickability: DOM0 handler props (`onclick`, …) and `addEventListener`
  instrumentation; the DOM exposes no standard marker for scripted handlers.
- Hover-reveal menus: `[aria-haspopup]` is standard; `onmouseover` props and
  listener instrumentation cover non-ARIA menus.
- Drag handles: `[draggable="true"]`, `[aria-grabbed]`, `[aria-roledescription]`
  first; jQuery-UI sortable class names remain as a last resort because that
  library adds no standard marker.
- Undo-like label filtering (`UNDO_LABEL` in `src/agent.ts`) excludes
  "remove/delete/clear/×" chips from typed-text autocomplete matches; no
  standard marks a control as an undo of a prior pick.
- Below-fold offers: DOM order with a bounded cap (120). Sites whose pagers
  carry no `rel`, landmark, or `aria-current` marker provide no standard rank
  signal; the cap bounds payload instead of guessing importance.
