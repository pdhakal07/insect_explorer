/**
 * app.js — Insect Explorer Gallery
 * Optimised for iPad 11-inch (834pt portrait / 1194pt landscape)
 * Safari iPadOS 16+ and Chrome iPadOS 120+
 *
 * Key iPad-specific changes vs original:
 *  1. HOLD_MS stays 2000ms but the hold-meter gives clear visual feedback
 *  2. MOVE_TOLERANCE_TOUCH raised to 36px — iPad stylus (Apple Pencil) and
 *     finger both drift more than a phone; 30px was too tight.
 *  3. Pointer capture is set with a try/catch that also handles iPadOS Safari
 *     occasionally throwing "InvalidStateError" when a second finger lands.
 *  4. overscroll-behavior: none on body prevents pull-to-refresh competing
 *     with the hold gesture (set in CSS).
 *  5. Audio unlock uses the same gesture-driven AudioContext approach but
 *     also tries to resume an existing suspended context on each pointerdown
 *     (iPadOS Safari can re-suspend after tab switching).
 *  6. Will-change is applied per-card in CSS for GPU compositing.
 */

const insects = [
  { slug: "butterfly",    name: "Butterfly"    },
  { slug: "ant",          name: "Ant"          },
  { slug: "grasshopper",  name: "Grasshopper"  },
  { slug: "beetle",       name: "Beetle"       },
  { slug: "fly",          name: "Fly"          },
  { slug: "mosquito",     name: "Mosquito"     },
  { slug: "termite",      name: "Termite"      },
  { slug: "bee",          name: "Bee"          },
  { slug: "wasp",         name: "Wasp"         },
  { slug: "dragonfly",    name: "Dragonfly"    },
  { slug: "stick_insect", name: "Stick Insect" },
  { slug: "cockroach",    name: "Cockroach"    }
];

const state = {
  busy:          false,
  holdTimer:     null,
  holdTriggered: false,
  activeCard:    null,
  activeAudio:   null,
  activeMode:    null,
  pointerId:     null,
  pointerType:   null,
  startX:        0,
  startY:        0,
  movedTooFar:   false,
  touchHandled:  false,
  hintDismissed: false
};

const HOLD_MS              = 2000;
const MOVE_TOLERANCE_MOUSE = 10;
// iPad 11" — raised from 30 to 36px: fingers and Apple Pencil drift more on
// the larger glass surface; avoids false "moved too far" cancellations.
const MOVE_TOLERANCE_TOUCH = 36;

const grid       = document.getElementById("insect-grid");
const liveRegion = document.getElementById("sr-status");

// ─────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  renderCards();
  renderHintBanner();
  announce("Gallery ready.");

  window.addEventListener("pagehide", stopAllPlayback);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAllPlayback();
  });

  // iPad: when the app returns from background, the AudioContext may be
  // re-suspended by the OS. Resume it as soon as the page is visible again.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Hint banner (onboarding)
// ─────────────────────────────────────────────────────────────────────
function renderHintBanner() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const banner = document.createElement("div");
  banner.className = "hint-banner";
  banner.setAttribute("role", "note");
  banner.innerHTML = `
    <div class="hint-inner">
      <span class="hint-icon" aria-hidden="true">💡</span>
      <span class="hint-text">
        <strong>Tap</strong> any insect to hear its sound &nbsp;·&nbsp;
        <strong>Hold 2 s</strong> for a full narration
      </span>
      <button class="hint-close" aria-label="Dismiss tip" type="button">×</button>
    </div>
  `;

  shell.querySelector(".topbar").insertAdjacentElement("afterend", banner);

  banner.querySelector(".hint-close").addEventListener("click", () => dismissHint(banner));

  grid.addEventListener("pointerup", () => {
    if (!state.hintDismissed) dismissHint(banner);
  }, { once: true });
}

function dismissHint(banner) {
  if (state.hintDismissed) return;
  state.hintDismissed = true;
  banner.classList.add("hint-hiding");
  setTimeout(() => banner.remove(), 320);
}

// ─────────────────────────────────────────────────────────────────────
// Card rendering
// ─────────────────────────────────────────────────────────────────────
function renderCards() {
  if (!grid) return;

  grid.innerHTML = insects.map((insect) => `
    <article
      class="insect-card"
      tabindex="0"
      role="button"
      aria-label="${insect.name}. Tap for insect sound. Press and hold for narration."
      data-slug="${insect.slug}"
    >
      <button class="card-close" type="button" aria-label="Stop narration">×</button>
      <div class="card-media">
        <img
          src="images/insects/${insect.slug}.png"
          alt="${insect.name}"
          loading="lazy"
          decoding="async"
          draggable="false"
        />
      </div>
      <div class="card-name" aria-hidden="true">${insect.name}</div>
      <div class="hold-meter" aria-hidden="true">
        <div class="hold-meter-fill"></div>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll(".insect-card").forEach((card) => {
    attachCardEvents(card);
    attachCloseButton(card);
    attachKeyboardEvents(card);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Pointer event handlers
// ─────────────────────────────────────────────────────────────────────
function attachCardEvents(card) {

  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".card-close")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (state.busy) { flashBusy(card); announce("Audio in progress."); return; }

    clearHoldTimer();

    state.holdTriggered = false;
    state.touchHandled  = false;
    state.activeCard    = card;
    state.pointerId     = e.pointerId;
    state.pointerType   = e.pointerType;
    state.startX        = e.clientX;
    state.startY        = e.clientY;
    state.movedTooFar   = false;

    card.classList.add("is-holding");

    // setPointerCapture can throw in iPadOS Safari if a concurrent gesture
    // is already captured; the try/catch prevents an uncaught error.
    try { card.setPointerCapture(e.pointerId); } catch (_) {}

    // For touch/pen: prevent scroll and context-menu during the hold gesture.
    // For mouse: allow the default so the click event fires normally.
    if (e.pointerType !== "mouse") {
      e.preventDefault();
    }

    state.holdTimer = setTimeout(async () => {
      if (state.busy)                return;
      if (state.activeCard !== card) return;
      if (state.movedTooFar)         return;

      state.holdTriggered = true;
      state.touchHandled  = true;
      card.classList.remove("is-holding");

      const insect = findInsect(card.dataset.slug);
      await playNarration(insect, card);
    }, HOLD_MS);
  });

  card.addEventListener("pointermove", (e) => {
    if (state.activeCard !== card) return;
    if (state.pointerId !== e.pointerId) return;

    const tolerance = (state.pointerType === "mouse")
      ? MOVE_TOLERANCE_MOUSE
      : MOVE_TOLERANCE_TOUCH;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    if (Math.sqrt(dx * dx + dy * dy) > tolerance) {
      state.movedTooFar = true;
      clearHoldTimer();
      card.classList.remove("is-holding");
    }
  });

  card.addEventListener("pointerup", async (e) => {
    if (state.pointerId !== e.pointerId) return;

    const wasTouch = state.pointerType !== "mouse";

    clearHoldTimer();
    card.classList.remove("is-holding");

    if (wasTouch) {
      if (!state.holdTriggered && !state.movedTooFar && !state.busy) {
        state.touchHandled = true;
        const insect = findInsect(card.dataset.slug);
        await playSound(insect, card);
      }
      state.touchHandled = true;
    }

    state.activeCard  = null;
    state.pointerId   = null;
    state.movedTooFar = false;
  });

  card.addEventListener("pointercancel", () => {
    clearHoldTimer();
    card.classList.remove("is-holding");
    state.activeCard   = null;
    state.pointerId    = null;
    state.movedTooFar  = false;
    state.touchHandled = false;
  });

  card.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") {
      clearHoldTimer();
      card.classList.remove("is-holding");
      state.activeCard  = null;
      state.pointerId   = null;
      state.movedTooFar = false;
    }
  });

  card.addEventListener("click", async (e) => {
    if (e.target.closest(".card-close")) return;

    if (state.touchHandled) {
      state.touchHandled = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (state.busy) { flashBusy(card); announce("Audio in progress."); return; }

    const insect = findInsect(card.dataset.slug);
    await playSound(insect, card);
  });

  // Suppress long-press context menu (image save / copy link dialogs on iPad)
  card.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ─────────────────────────────────────────────────────────────────────
// Close button (stop narration)
// ─────────────────────────────────────────────────────────────────────
function attachCloseButton(card) {
  const closeBtn = card.querySelector(".card-close");
  if (!closeBtn) return;

  closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (card.classList.contains("is-narrating")) stopNarration(card);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Keyboard events (external keyboard / Magic Keyboard support on iPad)
// ─────────────────────────────────────────────────────────────────────
function attachKeyboardEvents(card) {
  card.addEventListener("keydown", (e) => {
    if (e.repeat || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();

    if (state.busy) { flashBusy(card); announce("Audio in progress."); return; }

    clearHoldTimer();
    state.holdTriggered = false;
    state.activeCard    = card;
    card.classList.add("is-holding");

    state.holdTimer = setTimeout(async () => {
      state.holdTriggered = true;
      card.classList.remove("is-holding");
      const insect = findInsect(card.dataset.slug);
      await playNarration(insect, card);
    }, HOLD_MS);
  });

  card.addEventListener("keyup", async (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();

    clearHoldTimer();
    card.classList.remove("is-holding");
    state.activeCard = null;

    if (state.holdTriggered) { state.holdTriggered = false; return; }
    if (state.busy)          { flashBusy(card); announce("Audio in progress."); return; }

    const insect = findInsect(card.dataset.slug);
    await playSound(insect, card);
  });

  card.addEventListener("blur", () => {
    clearHoldTimer();
    card.classList.remove("is-holding");
    if (state.activeCard === card) state.activeCard = null;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function clearHoldTimer() {
  if (state.holdTimer) {
    clearTimeout(state.holdTimer);
    state.holdTimer = null;
  }
}

function setBusy(isBusy, card = null, mode = null) {
  state.busy       = isBusy;
  state.activeMode = mode;
  document.querySelectorAll(".insect-card").forEach((item) => {
    item.classList.toggle("is-busy",      isBusy && item !== card);
    item.classList.toggle("is-active",    isBusy && item === card);
    item.classList.toggle("is-narrating", isBusy && item === card && mode === "narration");
  });
}

function announce(message) {
  if (liveRegion) liveRegion.textContent = message;
}

function flashBusy(card) {
  if (!card || !card.animate) return;
  card.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-5px)" },
     { transform: "translateX(5px)" }, { transform: "translateX(0)" }],
    { duration: 260, iterations: 1 }
  );
}

function findInsect(slug) {
  return insects.find((item) => item.slug === slug);
}

// ─────────────────────────────────────────────────────────────────────
// Audio unlock — critical for iPadOS Safari
//
// iPadOS Safari (and Chrome iOS) block audio.play() called outside a
// direct user-gesture handler. The hold timer fires from setTimeout,
// which has no gesture context → NotAllowedError.
//
// Solution (same as original, with iPadOS-specific additions):
//   1. On the first pointerdown, create & resume an AudioContext.
//   2. Play a silent 1-frame buffer — standard Safari unlock trick.
//   3. Prime an <audio> element with volume 0.
//   4. On subsequent pointerdown events, try to resume the context
//      again in case iPadOS re-suspended it after tab-switching.
// ─────────────────────────────────────────────────────────────────────
let audioUnlocked = false;
let audioCtx      = null;

function unlockAudio() {
  // Always attempt to resume if the context was suspended (iPadOS may
  // suspend it on tab switch / split-screen switch).
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }

  if (audioUnlocked) return;
  audioUnlocked = true;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    const buf    = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buf;
    source.connect(audioCtx.destination);
    source.start(0);
  } catch (_) {}

  try {
    const primer   = new Audio();
    primer.src     = "audio/sound/ant.mp3";
    primer.volume  = 0;
    primer.muted   = true;
    primer.preload = "auto";
    const p = primer.play();
    if (p && typeof p.then === "function") {
      p.then(() => { primer.pause(); primer.src = ""; }).catch(() => {});
    }
  } catch (_) {}
}

// Re-run on every pointerdown (not just once) so we can resume a
// suspended AudioContext on each interaction.
document.addEventListener("pointerdown", unlockAudio, { passive: true });

// ─────────────────────────────────────────────────────────────────────
// Audio playback
// ─────────────────────────────────────────────────────────────────────
async function playSound(insect, card) {
  if (!insect || state.busy) return;
  setBusy(true, card, "sound");
  announce(`${insect.name} sound playing.`);
  try {
    await playAudioFile(`audio/sound/${insect.slug}.mp3`);
    announce(`${insect.name} sound finished.`);
  } catch (err) {
    console.error(err);
    announce(`${insect.name} sound could not play.`);
  } finally {
    finishPlayback();
  }
}

async function playNarration(insect, card) {
  if (!insect || state.busy) return;
  setBusy(true, card, "narration");
  announce(`${insect.name} narration playing.`);
  try {
    await playAudioFile(`audio/narrative/${insect.slug}.mp3`);
    announce(`${insect.name} narration finished.`);
  } catch (err) {
    if (!err || err.message !== "Narration stopped by user.") {
      console.error(err);
      announce(`${insect.name} narration could not play.`);
    }
  } finally {
    finishPlayback();
  }
}

function playAudioFile(source) {
  return new Promise((resolve, reject) => {
    const audio       = new Audio();
    state.activeAudio = audio;
    let settled       = false;
    let watchdog      = null;

    const settle = (fn) => {
      if (settled) return;
      settled           = true;
      clearTimeout(watchdog);
      audio.onended   = null;
      audio.onerror   = null;
      audio.oncanplay = null;
      state.activeAudio = null;
      fn();
    };

    // preload="metadata" — safe on mobile:
    //   • Loads only headers/duration, not the full file → no memory bomb
    //   • oncanplay fires reliably on iPadOS → no silent hang
    audio.preload = "metadata";
    audio.src     = source;

    audio.oncanplay = () => {
      audio.play().then(
        () => {},
        (err) => settle(() => reject(err))
      );
    };

    audio.onended = () => settle(() => resolve());

    audio.onerror = () =>
      settle(() => reject(new Error(`Cannot load audio: ${source}`)));

    // Safety net — unblock UI after 10s (slightly longer for iPad on
    // cellular or slow Wi-Fi where MP3 headers take longer to fetch)
    watchdog = setTimeout(
      () => settle(() => reject(new Error(`Audio load timeout: ${source}`))),
      10000
    );

    audio._rejectPlayback = (message) =>
      settle(() => reject(new Error(message)));
  });
}

function stopNarration(card) {
  if (!state.activeAudio || state.activeMode !== "narration") return;
  const audio = state.activeAudio;
  state.activeAudio = null;
  audio.pause();
  audio.currentTime = 0;
  if (typeof audio._rejectPlayback === "function") {
    audio._rejectPlayback("Narration stopped by user.");
  }
  if (card) card.classList.remove("is-narrating", "is-active");
  announce("Narration stopped.");
}

function finishPlayback() {
  document.querySelectorAll(".insect-card").forEach((card) => {
    card.classList.remove("is-holding", "is-active", "is-busy", "is-narrating");
  });
  state.busy          = false;
  state.holdTriggered = false;
  state.activeCard    = null;
  state.activeAudio   = null;
  state.activeMode    = null;
  state.pointerId     = null;
  state.pointerType   = null;
  state.movedTooFar   = false;
  state.touchHandled  = false;
}

function stopAllPlayback() {
  clearHoldTimer();
  if (state.activeAudio) {
    const audio = state.activeAudio;
    state.activeAudio = null;
    audio.pause();
    audio.currentTime = 0;
    if (typeof audio._rejectPlayback === "function") {
      audio._rejectPlayback("Playback stopped.");
    }
  }
  finishPlayback();
}
