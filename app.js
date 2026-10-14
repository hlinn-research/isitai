const NUM_QUESTIONS = 5;
const STORAGE_KEY = "isitai_quiz_state_v1";

const els = {
  progressLabel: document.getElementById("progress-label"),
  scoreLabel: document.getElementById("score-label"),
  options: document.getElementById("options"),
  feedback: document.getElementById("feedback"),
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
  els.nextBtn.classList.add("hidden");

  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.innerHTML = `
      <img src="${opt.file}" alt="Quiz image ${i + 1}" loading="lazy" />
      ${opt.credit ? `<div class="option-caption">${opt.credit}</div>` : ""}
    `;
    btn.addEventListener("click", () => handleAnswer(i));
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
    btn.disabled = true;
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

  els.scoreLabel.textContent = `Score: ${state.score}`;
  els.nextBtn.classList.remove("hidden");
  els.nextBtn.textContent =
    state.currentIndex === NUM_QUESTIONS - 1 ? "See results" : "Next question";
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

    const saved = loadState();
    if (saved && !saved.finished) {
      state = saved;
      renderQuestion();
    } else if (saved && saved.finished) {
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
