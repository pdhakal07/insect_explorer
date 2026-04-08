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
  currentName: ""
};

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
        <div class="card-media">
          <img src="images/insects/${insect.slug}.png" alt="${insect.name}" loading="lazy" draggable="false" />
        </div>
        <div class="hold-meter" aria-hidden="true"></div>
      </article>
    `
    )
    .join("");

  grid.querySelectorAll(".insect-card").forEach((card) => {
    attachPointerEvents(card);
    attachKeyboardEvents(card);
  });
}

function attachPointerEvents(card) {
  const start = (event) => {
    if (state.busy) {
      flashBusy(card);
      announce("Audio in progress.");
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) return;

    clearHoldTimer();
    state.holdTriggered = false;
    state.activeCard = card;
    card.classList.add("is-holding");

    state.holdTimer = setTimeout(async () => {
      state.holdTriggered = true;
      card.classList.remove("is-holding");
      const insect = findInsect(card.dataset.slug);
      await playNarration(insect, card);
    }, 2000);
  };

  const end = async () => {
    if (!state.activeCard || state.activeCard !== card) {
      clearHoldTimer();
      return;
    }

    const wasHold = state.holdTriggered;
    clearHoldTimer();
    card.classList.remove("is-holding");
    state.activeCard = null;

    if (wasHold) {
      state.holdTriggered = false;
      return;
    }

    const insect = findInsect(card.dataset.slug);
    await playSound(insect, card);
  };

  const cancel = () => {
    clearHoldTimer();
    state.holdTriggered = false;
    card.classList.remove("is-holding");
    if (state.activeCard === card) state.activeCard = null;
  };

  card.addEventListener("pointerdown", start);
  card.addEventListener("pointerup", end);
  card.addEventListener("pointerleave", cancel);
  card.addEventListener("pointercancel", cancel);
  card.addEventListener("contextmenu", (event) => event.preventDefault());
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
      card.classList.remove("is-holding");
      const insect = findInsect(card.dataset.slug);
      await playNarration(insect, card);
    }, 2000);
  });

  card.addEventListener("keyup", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();

    if (state.activeCard !== card) {
      clearHoldTimer();
      return;
    }

    const wasHold = state.holdTriggered;
    clearHoldTimer();
    card.classList.remove("is-holding");
    state.activeCard = null;

    if (wasHold) {
      state.holdTriggered = false;
      return;
    }

    const insect = findInsect(card.dataset.slug);
    await playSound(insect, card);
  });

  card.addEventListener("blur", () => {
    clearHoldTimer();
    state.holdTriggered = false;
    card.classList.remove("is-holding");
    if (state.activeCard === card) state.activeCard = null;
  });
}

function clearHoldTimer() {
  if (state.holdTimer) {
    clearTimeout(state.holdTimer);
    state.holdTimer = null;
  }
}

function setBusy(isBusy, insectName = "", card = null) {
  state.busy = isBusy;
  state.currentName = insectName;

  document.querySelectorAll(".insect-card").forEach((item) => {
    item.classList.toggle("is-busy", isBusy && item !== card);
    item.classList.toggle("is-active", isBusy && item === card);
  });
}

function announce(message) {
  if (liveRegion) liveRegion.textContent = message;
}

function flashBusy(card) {
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

  setBusy(true, insect.name, card);
  announce(`${insect.name} sound playing.`);

  try {
    await playAudioFile(`audio/sound/${insect.slug}.mp3`);
    announce(`${insect.name} sound finished.`);
  } catch (error) {
    console.error(error);
    announce(`${insect.name} sound could not play.`);
  } finally {
    setBusy(false, "");
  }
}

async function playNarration(insect, card) {
  if (!insect || state.busy) return;

  setBusy(true, insect.name, card);
  announce(`${insect.name} narration playing.`);

  try {
    await playAudioFile(`audio/narrative/${insect.slug}.mp3`);
    announce(`${insect.name} narration finished.`);
  } catch (error) {
    console.error(error);
    announce(`${insect.name} narration could not play.`);
  } finally {
    setBusy(false, "");
  }
}

function playAudioFile(source) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    state.activeAudio = audio;
    let settled = false;

    const cleanup = () => {
      audio.oncanplaythrough = null;
      audio.onended = null;
      audio.onerror = null;
    };

    audio.preload = "auto";
    audio.src = source;

    audio.oncanplaythrough = async () => {
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
  });
}

function stopAllPlayback() {
  clearHoldTimer();

  if (state.activeAudio) {
    state.activeAudio.pause();
    state.activeAudio.currentTime = 0;
    state.activeAudio = null;
  }

  document.querySelectorAll(".insect-card").forEach((card) => {
    card.classList.remove("is-holding", "is-active", "is-busy");
  });

  state.busy = false;
  state.holdTriggered = false;
  state.activeCard = null;
  state.currentName = "";
}