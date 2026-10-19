const NUM_QUESTIONS = 5;
const STORAGE_KEY = "isitai_quiz_state_v1";

const els = {
  progressLabel: document.getElementById("progress-label"),
  scoreLabel: document.getElementById("score-label"),
  options: document.getElementById("options"),
  feedback: document.getElementById("feedback"),
  why: document.getElementById("why"),
  nextBtn: document.getElementById("next-btn"),
  quizSection: document.getElementById("quiz"),
  resultsSection: document.getElementById("results"),
  guideSection: document.getElementById("guide"),
  finalScore: document.getElementById("final-score"),
  resultsBlurb: document.getElementById("results-blurb"),
  restartBtn: document.getElementById("restart-btn"),
};

let manifest = null;
let state = null;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickCyclic(pool, idx) {
  return pool[idx % pool.length];
}

function buildQuestions(manifest) {
  const aiPool = shuffle(manifest.ai);
  const realPool = shuffle(manifest.real);
  const questions = [];

  for (let i = 0; i < NUM_QUESTIONS; i++) {
    const aiImg = pickCyclic(aiPool, i);
    const real1 = pickCyclic(realPool, i * 2);
    const real2 = pickCyclic(realPool, i * 2 + 1);

    const options = shuffle([
      { file: aiImg.file, credit: aiImg.credit || "", isAI: true },
      { file: real1.file, credit: real1.credit || "", isAI: false },
      { file: real2.file, credit: real2.credit || "", isAI: false },
    ]);

    questions.push({ options, answeredIndex: null });
  }

  return questions;
}

function newQuizState(manifest) {
  return {
    questions: buildQuestions(manifest),
    currentIndex: 0,
    score: 0,
    finished: false,
  };
}

function saveState() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function renderQuestion() {
  els.resultsSection.classList.add("hidden");
  els.guideSection.classList.add("hidden");
  els.quizSection.classList.remove("hidden");

  const q = state.questions[state.currentIndex];
  els.progressLabel.textContent = `Question ${state.currentIndex + 1} of ${NUM_QUESTIONS}`;
  els.scoreLabel.textContent = `Score: ${state.score}`;
  els.options.innerHTML = "";
  els.feedback.classList.add("hidden");
  els.feedback.textContent = "";
  els.why.classList.add("hidden");
  els.why.replaceChildren();
  els.nextBtn.classList.add("hidden");

  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.innerHTML = `
      <img src="${opt.file}" alt="Quiz image ${i + 1}" loading="lazy" />
      ${opt.credit ? `<div class="option-caption">${opt.credit}</div>` : ""}
    `;
    // Before answering, a click picks the image; after, it opens it full size.
    btn.addEventListener("click", () => {
      if (q.answeredIndex === null) handleAnswer(i);
      else window.open(opt.file, "_blank", "noopener");
    });
    els.options.appendChild(btn);
  });

  if (q.answeredIndex !== null) {
    revealAnswer(q);
  }
}

function handleAnswer(choiceIndex) {
  const q = state.questions[state.currentIndex];
  if (q.answeredIndex !== null) return;

  q.answeredIndex = choiceIndex;
  const correct = q.options[choiceIndex].isAI;
  if (correct) state.score += 1;

  saveState();
  revealAnswer(q);
}

function revealAnswer(q) {
  const buttons = els.options.querySelectorAll(".option");
  const aiIndex = q.options.findIndex((o) => o.isAI);
  const wasCorrect = q.answeredIndex === aiIndex;

  buttons.forEach((btn, i) => {
    btn.classList.add("answered");
    btn.title = "Open full size in a new tab";
    if (i === aiIndex) btn.classList.add("reveal-ai");
    if (i === q.answeredIndex) {
      btn.classList.add(wasCorrect ? "correct-pick" : "incorrect-pick");
    }
  });

  els.feedback.classList.remove("hidden", "correct", "incorrect");
  els.feedback.classList.add(wasCorrect ? "correct" : "incorrect");
  els.feedback.textContent = wasCorrect
    ? "Correct — that one was AI-generated."
    : "Not quite — the highlighted image was the AI-generated one.";

  renderWhy(q.options[aiIndex].file);

  els.scoreLabel.textContent = `Score: ${state.score}`;
  els.nextBtn.classList.remove("hidden");
  els.nextBtn.textContent =
    state.currentIndex === NUM_QUESTIONS - 1 ? "See results" : "Next question";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// Explains what gives the AI image away, from its manifest entry.
function renderWhy(file) {
  const entry = manifest.ai.find((e) => e.file === file) || {};
  const reasons = entry.why || [];

  els.why.replaceChildren(el("h3", null, "Why it's AI"));

  if (reasons.length) {
    const list = el("ul", "tool-list");
    reasons.forEach((r) => list.appendChild(el("li", null, r)));
    els.why.appendChild(list);
  } else if (!entry.context) {
    els.why.appendChild(el("p", null, "There are no obvious giveaways in this one. That's why visual checks alone aren't enough."));
  }

  if (entry.context) els.why.appendChild(el("p", "why-context", entry.context));

  if (entry.source) {
    const p = el("p", "note", "Source: ");
    const a = el("a", null, entry.source.title);
    a.href = entry.source.url;
    a.target = "_blank";
    a.rel = "noopener";
    p.appendChild(a);
    els.why.appendChild(p);
  }

  els.why.appendChild(el("p", "note", "Click any image to open it full size in a new tab."));
  els.why.classList.remove("hidden");
}

function handleNext() {
  if (state.currentIndex < NUM_QUESTIONS - 1) {
    state.currentIndex += 1;
    saveState();
    renderQuestion();
  } else {
    state.finished = true;
    saveState();
    renderResults();
  }
}

function renderResults() {
  els.quizSection.classList.add("hidden");
  els.resultsSection.classList.remove("hidden");
  els.guideSection.classList.remove("hidden");

  els.finalScore.textContent = `${state.score}`;

  const blurbs = {
    5: "Perfect score — but real scammers aren't graded on a curve. Stay sharp.",
    4: "Solid instincts. A couple of these methods below will close the gap.",
    3: "About average — AI images are getting good enough that this is genuinely hard.",
  };
  els.resultsBlurb.textContent =
    blurbs[state.score] ||
    "This is exactly why relying on a photo alone is risky. Here's what actually helps:";
}

function startNewQuiz() {
  state = newQuizState(manifest);
  saveState();
  renderQuestion();
}

els.nextBtn.addEventListener("click", handleNext);
els.restartBtn.addEventListener("click", startNewQuiz);

fetch("images/manifest.json")
  .then((r) => r.json())
  .then((data) => {
    manifest = data;

    if (!manifest.ai || !manifest.ai.length || !manifest.real || manifest.real.length < 2) {
      els.quizSection.innerHTML =
        "<p>Add at least 1 AI image and 2 real images to <code>images/manifest.json</code> to start the quiz. See README.md.</p>";
      return;
    }

    // "#new" (from the home page) means: resume an unfinished quiz, otherwise start fresh.
    const wantsNew = location.hash === "#new";
    if (wantsNew) history.replaceState(null, "", location.pathname);

    const saved = loadState();
    if (saved && !saved.finished) {
      state = saved;
      renderQuestion();
    } else if (saved && saved.finished && !wantsNew) {
      state = saved;
      renderResults();
    } else {
      startNewQuiz();
    }
  })
  .catch((err) => {
    els.quizSection.innerHTML =
      "<p>Couldn't load images/manifest.json. Make sure it exists and is valid JSON.</p>";
    console.error(err);
  });
