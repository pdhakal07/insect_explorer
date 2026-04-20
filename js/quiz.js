// ── Available insects ─────────────────────────────────────────────────────
const INSECTS = [
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
  { slug: "cockroach",    name: "Cockroach"    },
];

// ── Question bank (20 questions, each correctSlug is unique within the bank
//    after deduplication logic fires — see pickQuestions()) ─────────────────
const ALL_QUESTIONS = [
  { text: "Which insect has a narrow waist and lives in colonies underground?", correctSlug: "ant",          distractors: ["butterfly", "grasshopper", "beetle"]   },
  { text: "Which insect has colorful wings and drinks nectar?",                 correctSlug: "butterfly",    distractors: ["fly", "beetle", "ant"]                  },
  { text: "Which insect jumps with strong back legs?",                          correctSlug: "grasshopper",  distractors: ["mosquito", "termite", "bee"]             },
  { text: "Which insect makes honey?",                                          correctSlug: "bee",          distractors: ["wasp", "beetle", "fly"]                  },
  { text: "Which insect has hardened shell-like wing covers?",                  correctSlug: "beetle",       distractors: ["butterfly", "mosquito", "dragonfly"]     },
  { text: "Which insect sucks blood from animals and humans?",                  correctSlug: "mosquito",     distractors: ["ant", "butterfly", "beetle"]             },
  { text: "Which insect buzzes around garbage and spoiled food?",               correctSlug: "fly",          distractors: ["bee", "dragonfly", "grasshopper"]        },
  { text: "Which insect builds paper nests from chewed wood?",                  correctSlug: "wasp",         distractors: ["bee", "ant", "fly"]                      },
  { text: "Which insect camouflages itself to look exactly like a twig?",       correctSlug: "stick_insect", distractors: ["beetle", "ant", "fly"]                   },
  { text: "Which insect is famous for catching prey mid-flight?",               correctSlug: "dragonfly",    distractors: ["butterfly", "ant", "termite"]            },
  { text: "Which insect eats wood and can silently destroy buildings?",         correctSlug: "termite",      distractors: ["grasshopper", "bee", "butterfly"]        },
  { text: "Which insect is a common household pest found in kitchens at night?",correctSlug: "cockroach",    distractors: ["butterfly", "dragonfly", "grasshopper"]  },
  // ── Extra pool: same correctSlugs but different question angles ────────────
  { text: "Which insect carries food back to its colony in organised lines?",   correctSlug: "ant",          distractors: ["fly", "mosquito", "beetle"]              },
  { text: "Which insect has wings covered in tiny overlapping scales?",         correctSlug: "butterfly",    distractors: ["beetle", "ant", "termite"]               },
  { text: "Which insect uses powerful hind legs to leap great distances?",      correctSlug: "grasshopper",  distractors: ["mosquito", "fly", "cockroach"]           },
  { text: "Which insect warns predators with bold yellow and black stripes?",   correctSlug: "bee",          distractors: ["fly", "termite", "ant"]                  },
  { text: "Which insect has a metallic iridescent shell on its back?",          correctSlug: "beetle",       distractors: ["dragonfly", "wasp", "termite"]           },
  { text: "Which insect uses a long needle-like mouthpart to pierce skin?",     correctSlug: "mosquito",     distractors: ["ant", "butterfly", "stick_insect"]       },
  { text: "Which insect spreads germs by walking on food surfaces?",            correctSlug: "fly",          distractors: ["bee", "wasp", "ant"]                     },
  { text: "Which insect scurries and hides when you turn on the lights?",       correctSlug: "cockroach",    distractors: ["butterfly", "bee", "dragonfly"]          },
];

const TOTAL_Q    = 8;
const NEXT_DELAY = 1150; // ms before auto-advancing

// ── BUG 8 FIX: Preload all insect images on page init ───────────────────
// quiz images use loading="eager" per question render, but the browser still
// fetches them lazily as each question appears. Preloading at startup means
// images are already in cache when each question renders — zero layout shift
// and no pop-in on slow tablets or local file:// access.
const _imageCache = [];

function preloadImages() {
  INSECTS.forEach(insect => {
    const img   = new Image();
    img.src     = `images/insects/${insect.slug}.png`;
    img.loading = "eager";
    _imageCache.push(img); // keep reference alive so GC doesn't discard it
  });
}

// Run immediately on script parse (not waiting for DOMContentLoaded)
preloadImages();

// ── State ─────────────────────────────────────────────────────────────────
let questions      = [];
let currentIndex   = 0;
let score          = 0;
let answered       = false;
let nextTimer      = null;   // BUG 1 fix: stored so it can be cleared on restart
let feedbackAudio  = null;   // BUG 2 fix: stored so it can be paused on restart

// ── Audio files loaded from manifest ──────────────────────────────────────
let CORRECT_SOUNDS = [];
let INCORRECT_SOUNDS = [];

// Load sound manifest on startup
(async () => {
  try {
    const response = await fetch("audio/quiz/manifest.json");
    const manifest = await response.json();
    CORRECT_SOUNDS = manifest.correct.map(f => `audio/quiz/${f}`);
    INCORRECT_SOUNDS = manifest.incorrect.map(f => `audio/quiz/${f}`);
  } catch (err) {
    console.error("Failed to load audio manifest:", err);
  }
})();

// ── DOM refs ──────────────────────────────────────────────────────────────
const splash       = document.getElementById("splash");
const quizArea     = document.getElementById("quiz-area");
const resultsEl    = document.getElementById("results");
const qCard        = document.getElementById("question-card");
const progressFill = document.getElementById("progress-fill");
const progressLbl  = document.getElementById("progress-label");
const abortModal   = document.getElementById("abort-modal");
const srStatus     = document.getElementById("sr-status");


document.getElementById("btn-start-quiz").addEventListener("click", startQuiz);
document.getElementById("btn-play-again").addEventListener("click", startQuiz);
document.getElementById("btn-restart").addEventListener("click",    startQuiz);
document.getElementById("btn-abort").addEventListener("click",      openAbortModal);
document.getElementById("btn-abort-cancel").addEventListener("click",  closeAbortModal);
document.getElementById("btn-abort-confirm").addEventListener("click", confirmAbort);

abortModal.addEventListener("click", e => {
  if (e.target === abortModal) closeAbortModal();
});

// ── Question picker: BUG 7 fix — ensures no duplicate correctSlug per round ─
function pickQuestions() {
  const shuffled    = shuffle(ALL_QUESTIONS);
  const picked      = [];
  const usedSlugs   = new Set();

  for (const q of shuffled) {
    if (usedSlugs.has(q.correctSlug)) continue;
    picked.push(q);
    usedSlugs.add(q.correctSlug);
    if (picked.length === TOTAL_Q) break;
  }

  // Fallback: if somehow we can't fill 8 unique-slug questions, relax constraint
  if (picked.length < TOTAL_Q) {
    for (const q of shuffled) {
      if (!picked.includes(q)) {
        picked.push(q);
        if (picked.length === TOTAL_Q) break;
      }
    }
  }

  return picked;
}

// ── Audio feedback ────────────────────────────────────────────────────────
function playFeedback(correct) {
  // BUG 2 fix: stop any still-playing feedback audio first
  if (feedbackAudio) {
    feedbackAudio.pause();
    feedbackAudio = null;
  }

  // Randomly select from correct or incorrect sounds
  const sounds = correct ? CORRECT_SOUNDS : INCORRECT_SOUNDS;
  if (sounds.length === 0) return; // Skip if no sounds available

  const src = sounds[Math.floor(Math.random() * sounds.length)];
  const a      = new Audio(src);
  a.volume     = 0.7;
  feedbackAudio = a;
  a.play().catch(() => {});
  a.onended = () => { feedbackAudio = null; };
}

// ── Shuffle ───────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Start / Restart ───────────────────────────────────────────────────────
function startQuiz() {
  const backLink = document.querySelector(".back-link");
  if (backLink) backLink.style.display = "none";
  // BUG 1 fix: cancel any pending auto-advance
  if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
  // BUG 2 fix: stop orphaned audio
  if (feedbackAudio) { feedbackAudio.pause(); feedbackAudio = null; }

  questions    = pickQuestions();
  currentIndex = 0;
  score        = 0;
  answered     = false;

  closeAbortModal();

  splash.style.display    = "none";
  resultsEl.style.display = "none";
  quizArea.style.display  = "block";

  renderQuestion();
  announce("Quiz started. Question 1 of " + TOTAL_Q);
}

// ── Render question ───────────────────────────────────────────────────────
function renderQuestion() {
  answered = false;
  const q = questions[currentIndex];

  const correctInsect   = INSECTS.find(i => i.slug === q.correctSlug);
  const distractorSlugs = shuffle(q.distractors).slice(0, 3);
  const choices         = shuffle([
    correctInsect,
    ...distractorSlugs.map(s => INSECTS.find(i => i.slug === s)).filter(Boolean),
  ]);

  // Progress
  const pct = (currentIndex / TOTAL_Q) * 100;
  progressFill.style.width = pct + "%";
  progressLbl.textContent  = (currentIndex + 1) + " / " + TOTAL_Q;

  qCard.innerHTML = `
    <div class="q-meta">
      <div class="q-badge">${currentIndex + 1}</div>
      <p class="q-text">${q.text}</p>
    </div>
    <div class="choices-grid">
      ${choices.map(insect => `
        <button
          class="choice-btn"
          data-slug="${insect.slug}"
          data-name="${insect.name}"
          aria-label="${insect.name}"
        >
          <img
            src="images/insects/${insect.slug}.png"
            alt="${insect.name}"
            loading="eager"
            draggable="false"
          />
          <span class="choice-label">${insect.name}</span>
          <div class="feedback-overlay" aria-hidden="true">
            <span class="feedback-icon"></span>
            <span class="feedback-name"></span>
          </div>
        </button>
      `).join("")}
    </div>
  `;

  qCard.querySelectorAll(".choice-btn").forEach(btn => {
    btn.addEventListener("click", () => handleChoice(btn, q.correctSlug));
  });

  // Re-trigger animation
  qCard.style.animation = "none";
  void qCard.offsetHeight;
  qCard.style.animation = "";
}

// ── Handle choice ─────────────────────────────────────────────────────────
function handleChoice(btn, correctSlug) {
  if (answered) return;
  answered = true;

  const isCorrect = btn.dataset.slug === correctSlug;
  const allBtns   = qCard.querySelectorAll(".choice-btn");

  allBtns.forEach(b => { b.disabled = true; });

  // Find correct insect name for FIX 6 label
  const correctInsect = INSECTS.find(i => i.slug === correctSlug);
  const correctName   = correctInsect ? correctInsect.name : correctSlug.replace("_", " ");

  if (isCorrect) {
    score++;
    applyFeedback(btn, "correct", "✓", btn.dataset.name);
    announce("Correct! That is the " + btn.dataset.name + ".");
  } else {
    applyFeedback(btn, "wrong", "✗", btn.dataset.name);

    // FIX 6: show correct answer with its name clearly
    allBtns.forEach(b => {
      if (b.dataset.slug === correctSlug) {
        applyFeedback(b, "correct", "✓", correctName);
      } else if (b !== btn) {
        b.classList.add("dim");
      }
    });

    announce("Incorrect. The correct answer is the " + correctName + ".");
  }

  playFeedback(isCorrect);

  // BUG 1 fix: store timer reference
  const delay = isCorrect ? NEXT_DELAY : NEXT_DELAY + 400;
  nextTimer = setTimeout(() => {
    nextTimer = null;
    currentIndex++;
    if (currentIndex < TOTAL_Q) {
      renderQuestion();
    } else {
      showResults();
    }
  }, delay);
}

// ── Apply feedback overlay ─────────────────────────────────────────────────
function applyFeedback(btn, type, icon, name) {
  btn.classList.add(type);
  const iconEl = btn.querySelector(".feedback-icon");
  const nameEl = btn.querySelector(".feedback-name");
  if (iconEl) iconEl.textContent = icon;
  // FIX 6: show insect name in overlay — most useful on wrong answers
  if (nameEl) nameEl.textContent = name;
}

// ── Results ───────────────────────────────────────────────────────────────
function showResults() {
  const backLink = document.querySelector(".back-link");
  if (backLink) backLink.style.display = "block";
  quizArea.style.display = "none";
  progressFill.style.width = "100%";

  const pct = Math.round((score / TOTAL_Q) * 100);
  const deg = pct * 3.6;

  document.getElementById("score-number").textContent = score;

  // FIX 7: set conic-gradient directly via inline style — bypasses CSS var
  // parsing bug in older Android WebViews (Chromium < 90)
  const accent    = "#8cf1c9";
  const trackClr  = "rgba(143,194,226,0.1)";
  document.getElementById("score-circle").style.background =
    `conic-gradient(${accent} ${deg}deg, ${trackClr} ${deg}deg)`;

  let title, msg, celebrationSound;
  if (score === TOTAL_Q) {
    title = "🏆 Perfect Score!";
    msg   = "Incredible! You identified every insect correctly. You're a true entomologist!";
    celebrationSound = "audio/quiz/perfect_score.mp3";
  } else if (score >= 6) {
    title = "🌟 Excellent!";
    msg   = `You got ${score} out of ${TOTAL_Q}. Great bug knowledge — just a couple to review!`;
    celebrationSound = "audio/quiz/excellent.mp3";
  } else if (score >= 4) {
    title = "👍 Good Effort!";
    msg   = `You got ${score} out of ${TOTAL_Q}. Solid start — a bit more studying and you'll ace it!`;
    celebrationSound = "audio/quiz/good_effort.mp3";
  } else {
    title = "🐛 Keep Exploring!";
    msg   = `You got ${score} out of ${TOTAL_Q}. Head back to the gallery and learn those insects!`;
    celebrationSound = "audio/quiz/keep_exploring.mp3";
  }

  document.getElementById("results-title").textContent = title;
  document.getElementById("results-msg").textContent   = msg;
  resultsEl.style.display = "flex";

  // Play celebration sound based on score
  if (feedbackAudio) {
    feedbackAudio.pause();
    feedbackAudio = null;
  }
  const celebrationAudio = new Audio(celebrationSound);
  celebrationAudio.volume = 0.7;
  celebrationAudio.play().catch(() => {});

  announce(`Quiz complete. You scored ${score} out of ${TOTAL_Q}.`);
}

// ── Abort modal ───────────────────────────────────────────────────────────
function openAbortModal() {
  abortModal.classList.add("open");
  document.getElementById("btn-abort-cancel").focus();
  announce("Abort dialog opened.");
}

function closeAbortModal() {
  abortModal.classList.remove("open");
}

function confirmAbort() {
  if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
  if (feedbackAudio) { feedbackAudio.pause(); feedbackAudio = null; }

  const backLink = document.querySelector(".back-link");
  if (backLink) backLink.style.display = "block";
  abortModal.classList.remove("open");
  quizArea.style.display  = "none";
  resultsEl.style.display = "none";
  splash.style.display    = "flex";
  announce("Quiz aborted. Back to start.");
}

// ── Keyboard: Escape closes modal ─────────────────────────────────────────
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && abortModal.classList.contains("open")) {
    closeAbortModal();
  }
});

// ── Accessibility ─────────────────────────────────────────────────────────
function announce(msg) {
  if (srStatus) srStatus.textContent = msg;
}
