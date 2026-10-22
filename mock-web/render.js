// Minimal dynamic form renderer driven by the survey JSON schema.
// Built as a test fixture so the skip-logic ("visibilityLogic") automated
// test in tests/web/skip-logic.spec.ts has something real to exercise,
// mirroring the engine described in "2.Survey Builder Tool Capabilities.html"
// (section 8) and "1.Android App Specification.html" (Considerations, item 1).

const SURVEY_INDEX = 2; // "Student Interests & Hobbies" — has the hobby skip rule.

function getQuestionValue(questionId) {
  const el = document.querySelector(`[data-question-id="${questionId}"] [data-input]`);
  if (!el) return undefined;
  return el.value;
}

function evaluateCondition(condition, actual, expected) {
  const a = actual ?? '';
  switch (condition) {
    case 'equals':
      return a === expected;
    case 'not_equals':
      return a !== expected;
    case 'contains':
      return a.includes(expected);
    case 'greater_than':
      return Number(a) > Number(expected);
    case 'less_than':
      return Number(a) < Number(expected);
    case 'is_empty':
      return a === '';
    case 'is_not_empty':
      return a !== '';
    default:
      return true;
  }
}

function isQuestionVisible(question) {
  const logic = question.visibilityLogic;
  if (!logic || !logic.enabled) return true;
  const actual = getQuestionValue(logic.targetQuestion);
  return evaluateCondition(logic.condition, actual, logic.value);
}

function refreshVisibility(allQuestionEls) {
  for (const { el, question } of allQuestionEls) {
    el.hidden = !isQuestionVisible(question);
  }
}

function renderInput(question) {
  const type = question.inputType;
  if (type === 'Dropdown' || type === 'Radio') {
    const select = document.createElement('select');
    select.setAttribute('data-input', '');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— select —';
    select.appendChild(blank);
    for (const opt of question.options || []) {
      const label = typeof opt === 'string' ? opt : opt.label;
      const value = typeof opt === 'string' ? opt : opt.label;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    return select;
  }
  if (type === 'Number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.setAttribute('data-input', '');
    return input;
  }
  // Text / TextArea / default
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('data-input', '');
  return input;
}

async function main() {
  const res = await fetch('./schema-fixed.json');
  const schema = await res.json();
  const survey = schema.surveys[SURVEY_INDEX].surveyData;

  document.getElementById('survey-title').textContent = survey.title;
  const root = document.getElementById('survey-root');

  const allQuestionEls = [];

  for (const section of survey.sections) {
    const sectionEl = document.createElement('section');
    sectionEl.setAttribute('data-section-id', section.sectionId);

    const heading = document.createElement('h2');
    heading.textContent = section.title;
    sectionEl.appendChild(heading);

    for (const question of section.questions) {
      const questionEl = document.createElement('div');
      questionEl.className = 'question';
      questionEl.setAttribute('data-question-id', question.questionId);

      const label = document.createElement('label');
      label.textContent = question.questionText;
      questionEl.appendChild(label);

      if (question.hintText) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = question.hintText;
        questionEl.appendChild(hint);
      }

      const input = renderInput(question);
      input.addEventListener('input', () => refreshVisibility(allQuestionEls));
      input.addEventListener('change', () => refreshVisibility(allQuestionEls));
      questionEl.appendChild(input);

      sectionEl.appendChild(questionEl);
      allQuestionEls.push({ el: questionEl, question });
    }

    root.appendChild(sectionEl);
  }

  refreshVisibility(allQuestionEls);
}

main();
