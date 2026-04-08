const insects = [
  { slug: "butterfly", name: "Butterfly" },
  { slug: "ant", name: "Ant" },
  { slug: "grasshopper", name: "Grasshopper" },
  { slug: "beetle", name: "Beetle" },
  { slug: "fly", name: "Fly" },
  { slug: "mosquito", name: "Mosquito" },
  { slug: "termite", name: "Termite" },
  { slug: "bee", name: "Bee" },
  { slug: "wasp", name: "Wasp" },
  { slug: "dragonfly", name: "Dragonfly" },
  { slug: "stick_insect", name: "Stick Insect" },
  { slug: "cockroach", name: "Cockroach" }
];

const state = {
  busy: false,
  holdTimer: null,
  holdTriggered: false,
  activeCard: null,
  activeAudio: null,
  activeMode: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  movedTooFar: false,
  suppressNextClick: false
};

const HOLD_MS = 2000;
const MOVE_TOLERANCE = 18;

const grid = document.getElementById("insect-grid");
const liveRegion = document.getElementById("sr-status");

document.addEventListener("DOMContentLoaded", () => {
  renderCards();
  announce("Gallery ready.");

  window.addEventListener("pagehide", stopAllPlayback);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAllPlayback();
  });
});

function renderCards() {
  if (!grid) return;

  grid.innerHTML = insects
    .map(
      (insect) => `
      <article
        class="insect-card"
        tabindex="0"
        role="button"
        aria-label="${insect.name}. Tap for insect sound. Press and hold for narration."
        data-slug="${insect.slug}"
      >
        <button class="card-close" type="button" aria-label="Stop narration">×</button>
        <div class="card-media">
          <img src="images/insects/${insect.slug}.png" alt="${insect.name}" loading="lazy" draggable="false" />
        </div>
        <div class="hold-meter" aria-hidden="true"></div>
      </article>
    `
    )
    .join("");

  grid.querySelectorAll(".insect-card").forEach((card) => {
    attachCardEvents(card);
    attachCloseButton(card);
    attachKeyboardEvents(card);
  });
}

function attachCardEvents(card) {
  card.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".card-close")) return;
    onPressStart(event, card);
  });

  card.addEventListener("pointermove", (event) => {
    if (state.activeCard !== card) return;
    if (state.pointerId !== event.pointerId) return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > MOVE_TOLERANCE) {
      state.movedTooFar = true;
      clearHoldTimer();
      card.classList.remove("is-holding");
    }
  });

  card.addEventListener("pointerup", (event) => {
    if (state.pointerId !== event.pointerId) return;
    endPress(card);
  });

  card.addEventListener("pointercancel", () => {
    endPress(card);
  });

  card.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") {
      endPress(card);
    }
  });

  card.addEventListener("click", async (event) => {
    if (event.target.closest(".card-close")) return;

    if (state.suppressNextClick) {
      event.preventDefault();
      event.stopPropagation();
      state.suppressNextClick = false;
      return;
    }

    if (state.busy) {
      flashBusy(card);
      announce("Audio in progress.");
      return;
    }

    const insect = findInsect(card.dataset.slug);
    await playSound(insect, card);
  });

  card.addEventListener("contextmenu", (event) => event.preventDefault());
}

function onPressStart(event, card) {
  if (state.busy) {
    flashBusy(card);
    announce("Audio in progress.");
    return;
  }

  if (event.pointerType === "mouse" && event.button !== 0) return;

  clearHoldTimer();

  state.holdTriggered = false;
  state.activeCard = card;
  state.pointerId = event.pointerId;
  state.startX = event.clientX;
  state.startY = event.clientY;
  state.movedTooFar = false;

  card.classList.add("is-holding");

  try {
    card.setPointerCapture(event.pointerId);
  } catch (_) {}

  if (event.pointerType !== "mouse") {
    event.preventDefault();
  }

  state.holdTimer = setTimeout(async () => {
    if (state.busy) return;
    if (state.activeCard !== card) return;
    if (state.movedTooFar) return;

    state.holdTriggered = true;
    state.suppressNextClick = true;
    card.classList.remove("is-holding");

    const insect = findInsect(card.dataset.slug);
    await playNarration(insect, card);
  }, HOLD_MS);
}

function endPress(card) {
  clearHoldTimer();

  if (card) {
    card.classList.remove("is-holding");
  }

  state.activeCard = null;
  state.pointerId = null;
  state.movedTooFar = false;
}

function attachKeyboardEvents(card) {
  card.addEventListener("keydown", (event) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();

    if (state.busy) {
      flashBusy(card);
      announce("Audio in progress.");
      return;
    }

    clearHoldTimer();
    state.holdTriggered = false;
    state.activeCard = card;
    card.classList.add("is-holding");

    state.holdTimer = setTimeout(async () => {
      state.holdTriggered = true;
      state.suppressNextClick = true;
      card.classList.remove("is-holding");

      const insect = findInsect(card.dataset.slug);
      await playNarration(insect, card);
    }, HOLD_MS);
  });

  card.addEventListener("keyup", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();

    clearHoldTimer();
    card.classList.remove("is-holding");
    state.activeCard = null;

    if (state.holdTriggered) {
      state.holdTriggered = false;
      return;
    }

    if (state.busy) {
      flashBusy(card);
      announce("Audio in progress.");
      return;
    }

    const insect = findInsect(card.dataset.slug);
    await playSound(insect, card);
  });

  card.addEventListener("blur", () => {
    clearHoldTimer();
    card.classList.remove("is-holding");
    if (state.activeCard === card) {
      state.activeCard = null;
    }
  });
}

function attachCloseButton(card) {
  const closeBtn = card.querySelector(".card-close");
  if (!closeBtn) return;

  closeBtn.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });

  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (card.classList.contains("is-narrating")) {
      stopNarration(card);
    }
  });
}

function clearHoldTimer() {
  if (state.holdTimer) {
    clearTimeout(state.holdTimer);
    state.holdTimer = null;
  }
}

function setBusy(isBusy, card = null, mode = null) {
  state.busy = isBusy;
  state.activeMode = mode;

  document.querySelectorAll(".insect-card").forEach((item) => {
    item.classList.toggle("is-busy", isBusy && item !== card);
    item.classList.toggle("is-active", isBusy && item === card);
    item.classList.toggle("is-narrating", isBusy && item === card && mode === "narration");
  });
}

function announce(message) {
  if (liveRegion) liveRegion.textContent = message;
}

function flashBusy(card) {
  if (!card || !card.animate) return;

  card.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-5px)" },
      { transform: "translateX(5px)" },
      { transform: "translateX(0)" }
    ],
    { duration: 260, iterations: 1 }
  );
}

function findInsect(slug) {
  return insects.find((item) => item.slug === slug);
}

async function playSound(insect, card) {
  if (!insect || state.busy) return;

  setBusy(true, card, "sound");
  announce(`${insect.name} sound playing.`);

  try {
    await playAudioFile(`audio/sound/${insect.slug}.mp3`);
    announce(`${insect.name} sound finished.`);
  } catch (error) {
    console.error(error);
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
  } catch (error) {
    if (!error || error.message !== "Narration stopped by user.") {
      console.error(error);
      announce(`${insect.name} narration could not play.`);
    }
  } finally {
    finishPlayback();
  }
}

function playAudioFile(source) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    state.activeAudio = audio;
    let settled = false;

    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.onloadeddata = null;
    };

    audio.preload = "auto";
    audio.src = source;

    audio.onloadeddata = async () => {
      if (settled) return;

      try {
        await audio.play();
      } catch (error) {
        settled = true;
        cleanup();
        state.activeAudio = null;
        reject(error);
      }
    };

    audio.onended = () => {
      if (settled) return;
      settled = true;
      cleanup();
      state.activeAudio = null;
      resolve();
    };

    audio.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      state.activeAudio = null;
      reject(new Error(`Missing audio file: ${source}`));
    };

    audio._rejectPlayback = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      state.activeAudio = null;
      reject(new Error(message));
    };
  });
}

function stopNarration(card) {
  if (!state.activeAudio) return;
  if (state.activeMode !== "narration") return;

  const audio = state.activeAudio;
  state.activeAudio = null;

  audio.pause();
  audio.currentTime = 0;

  if (typeof audio._rejectPlayback === "function") {
    audio._rejectPlayback("Narration stopped by user.");
  }

  if (card) {
    card.classList.remove("is-narrating", "is-active");
  }

  announce("Narration stopped.");
}

function finishPlayback() {
  document.querySelectorAll(".insect-card").forEach((card) => {
    card.classList.remove("is-holding", "is-active", "is-busy", "is-narrating");
  });

  state.busy = false;
  state.holdTriggered = false;
  state.activeCard = null;
  state.activeAudio = null;
  state.activeMode = null;
  state.pointerId = null;
  state.movedTooFar = false;
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