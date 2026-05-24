const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAgents() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'agents.js'), 'utf8');
  const context = vm.createContext({ console });
  vm.runInContext(`${source}\nglobalThis.__AGENTS = AGENTS;`, context);
  return context.__AGENTS;
}

const sampleFields = {
  job_title: 'Senior Software Engineer',
  cv_file: 'Built internal platform.',
  cv_text: 'Led a team of five engineers.',
  job_desc: 'Needs cloud and security experience.',
  format: 'Hybrid/Combination',
  email_type: 'Follow-up',
  recipient: 'Hiring Manager',
  context: 'Thank them for the interview and ask about next steps.',
  tone: 'Formal & Professional',
  source_file: 'Chapter one text.',
  raw_text: 'Photosynthesis converts light into chemical energy.',
  subject: 'Biology',
  contract_file: 'Agreement text.',
  contract_text: 'The tenant must pay rent monthly.',
  focus: 'payment terms',
  destination: 'Tokyo',
  duration: '7 days',
  budget: 'Mid-range',
  interests: 'food, museums, transit',
  month: 'April',
  event_type: 'Conference',
  guests: '150',
  date: 'September 2026',
  details: 'Needs sponsor booths.',
  company: 'ExampleCo',
  bg_file: 'Resume summary.',
  your_background: 'Frontend developer with accessibility experience.',
  current_headline: 'Software Engineer',
  target_role: 'Senior Product Engineer',
  experience: 'Six years building SaaS products.',
  current_summary: 'I build web apps.'
};

test('all agent prompts include prompt-injection guardrails', () => {
  const agents = loadAgents();

  for (const [id, agent] of Object.entries(agents)) {
    assert.match(agent.systemPrompt, /Do not ignore instructions/i, id);
    assert.match(agent.systemPrompt, /### delimiters/i, id);
  }
});

test('all buildPrompt functions wrap user content in delimiters', () => {
  const agents = loadAgents();

  for (const [id, agent] of Object.entries(agents)) {
    const prompt = agent.buildPrompt(sampleFields);
    assert.match(prompt, /### USER PROVIDED CONTENT ###/, id);
    assert.match(prompt, /### END USER PROVIDED CONTENT ###/, id);
    assert.match(prompt, /Do not ignore instructions/i, id);
  }
});
