
const state = {
  busy:           false,
  holdTimer:      null,
  holdTriggered:  false,
  activeCard:     null,
  activeAudio:    null,
  activeMode:     null,
  pointerId:      null,
  pointerType:    null,   // "mouse" | "touch" | "pen"
  startX:         0,
  startY:         0,
  movedTooFar:    false,
  touchHandled:   false,  // suppresses synthetic click after touch pointerup
  hintDismissed:  false
};

const HOLD_MS              = 2000;
const MOVE_TOLERANCE_MOUSE = 10;   // px
const MOVE_TOLERANCE_TOUCH = 30;   // px

const grid       = document.getElementById("insect-grid");
const liveRegion = document.getElementById("sr-status");


document.addEventListener("DOMContentLoaded", () => {
  renderCards();
  renderHintBanner();
  announce("Gallery ready.");
  window.addEventListener("pagehide", stopAllPlayback);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAllPlayback();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Hint banner
// ─────────────────────────────────────────────────────────────────────
function renderHintBanner() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const banner = document.createElement("div");
  banner.className = "hint-banner";
  banner.setAttribute("role", "note");
  banner.innerHTML = `
    <div class="hint-inner">
      <span class="hint-icon">💡</span>
      <span class="hint-text">
        <strong>Tap</strong> any insect to hear its sound &nbsp;·&nbsp;
        <strong>Hold</strong> for a full narration
      </span>
      <button class="hint-close" aria-label="Dismiss tip">×</button>
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

  grid.innerHTML = INSECTS.map((insect) => `
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
// Audio unlock — must happen on first direct user gesture
//
// Mobile browsers block audio.play() unless called inside a user-gesture
// handler. The hold-narration fires from setTimeout with no gesture context.
// Fix: on first pointerdown, resume AudioContext and prime the <audio>
// pipeline. This permanently unlocks audio for the entire session.
// ─────────────────────────────────────────────────────────────────────
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // Unlock Web Audio API (required by iOS Safari)
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const buf    = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.connect(ctx.destination);
    source.start(0);
  } catch (_) {}

  // Prime <audio> element pipeline (Chrome Android)
  try {
    const primer  = new Audio();
    primer.src    = "audio/sound/ant.mp3";
    primer.volume = 0;
    primer.muted  = true;
    const p = primer.play();
    if (p && typeof p.then === "function") {
      p.then(() => { primer.pause(); primer.src = ""; }).catch(() => {});
    }
  } catch (_) {}
}

// Non-passive so e.preventDefault() still works inside card handlers
document.addEventListener("pointerdown", unlockAudio, { once: true });

// ─────────────────────────────────────────────────────────────────────
// Pointer event handlers
// ─────────────────────────────────────────────────────────────────────
function attachCardEvents(card) {

  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".card-close")) return;
    if (state.busy && state.activeMode === "narration") return;
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
    try { card.setPointerCapture(e.pointerId); } catch (_) {}

    // Prevent scroll/context-menu on touch; don't block mouse (would break click)
    if (e.pointerType !== "mouse") e.preventDefault();

    state.holdTimer = setTimeout(async () => {
      if (state.busy || state.activeCard !== card || state.movedTooFar) return;
      state.holdTriggered = true;
      state.touchHandled  = true;  // suppress synthetic click / pointerup sound
      card.classList.remove("is-holding");
      const insect = findInsect(card.dataset.slug);
      await playNarration(insect, card);
    }, HOLD_MS);
  });

  card.addEventListener("pointermove", (e) => {
    if (state.activeCard !== card || state.pointerId !== e.pointerId) return;
    const tolerance = state.pointerType === "mouse"
      ? MOVE_TOLERANCE_MOUSE : MOVE_TOLERANCE_TOUCH;
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

    if (state.activeMode === "narration") {
      state.activeCard   = null;
      state.pointerId    = null;
      state.movedTooFar  = false;
      state.touchHandled = true;
      return;
    }

    if (wasTouch && !state.holdTriggered && !state.movedTooFar && !state.busy) {
      state.touchHandled = true;
      const insect = findInsect(card.dataset.slug);
      await playSound(insect, card);
    } else if (wasTouch) {
      state.touchHandled = true;  // suppress synthetic click even if we didn't play
    }

    state.activeCard  = null;
    state.pointerId   = null;
    state.movedTooFar = false;
  });

  card.addEventListener("pointercancel", () => {
    if (state.activeMode === "narration") return;
    clearHoldTimer();
    card.classList.remove("is-holding");
    state.activeCard   = null;
    state.pointerId    = null;
    state.movedTooFar  = false;
    state.touchHandled = true;  // suppress any incoming synthetic click
  });

  card.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    if (state.activeMode === "narration") return;
    clearHoldTimer();
    card.classList.remove("is-holding");
    state.activeCard  = null;
    state.pointerId   = null;
    state.movedTooFar = false;
  });

  card.addEventListener("click", async (e) => {
    if (e.target.closest(".card-close")) return;

    if (state.touchHandled) {
      state.touchHandled = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (state.busy && state.activeMode === "narration") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (state.busy) { flashBusy(card); announce("Audio in progress."); return; }

    const insect = findInsect(card.dataset.slug);
    await playSound(insect, card);
  });

  card.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ─────────────────────────────────────────────────────────────────────
// Close button
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
// Keyboard events
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
  if (state.holdTimer) { clearTimeout(state.holdTimer); state.holdTimer = null; }
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
  return INSECTS.find((item) => item.slug === slug);
}

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

// ─────────────────────────────────────────────────────────────────────
// playAudioFile
//
// CRITICAL mobile fix: call audio.play() immediately after setting src,
// NOT inside oncanplay. On iOS Safari, oncanplay fires after the gesture
// window closes, causing NotAllowedError (silent failure). The correct
// pattern is to call play() immediately — the browser loads-as-it-plays.
// ─────────────────────────────────────────────────────────────────────
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
      audio.onended  = null;
      audio.onerror  = null;
      state.activeAudio = null;
      fn();
    };

    audio.preload = "auto";
    audio.src     = source;
    audio.onended = () => settle(() => resolve());
    audio.onerror = () => settle(() => reject(new Error(`Cannot load audio: ${source}`)));

    // Watchdog: 2-minute max (generous for long narrations)
    watchdog = setTimeout(
      () => settle(() => reject(new Error(`Audio timeout: ${source}`))),
      120000
    );

    // Call play() immediately — this is the critical mobile fix.
    // The browser will start loading and play as data arrives.
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch((err) => settle(() => reject(err)));
    }

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