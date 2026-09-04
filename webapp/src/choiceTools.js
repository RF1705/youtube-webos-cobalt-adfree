import './choiceTools.css';

let choiceTabIndex = 100;
const choices = {};

function render(control) {
  const entry = choices[control.id];
  if (!entry) return;

  const selected = entry.options.find((option) => option.value === entry.value);
  control.textContent = selected ? selected.label : entry.value;
}

function cycle(name) {
  const control = document.querySelector('#' + name);
  const entry = choices[name];
  if (!control || !entry || entry.options.length === 0) return;

  const currentIndex = entry.options.findIndex(
    (option) => option.value === entry.value
  );
  const nextIndex = (currentIndex + 1) % entry.options.length;
  entry.value = entry.options[nextIndex].value;
  render(control);
  if (entry.callback) entry.callback(entry.value);
}

function add(name, label, value, options, callback = null) {
  const wrapper = document.createElement('div');
  wrapper.classList.add('choice-wrapper');

  const description = document.createElement('div');
  description.classList.add('desc');
  description.textContent = label;

  const control = document.createElement('div');
  control.id = name;
  control.classList.add('choice-value');
  control.tabIndex = choiceTabIndex;
  control.dataset.ytafControl = 'choice';

  choices[name] = { value, options, callback };
  render(control);

  wrapper.appendChild(description);
  wrapper.appendChild(control);
  wrapper.addEventListener(
    'click',
    (event) => {
      if (Number(wrapper.dataset.ytafIgnoreClickUntil || 0) > Date.now()) {
        delete wrapper.dataset.ytafIgnoreClickUntil;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      cycle(name);
    },
    true
  );
  control.addEventListener('focus', () => wrapper.classList.add('ytaf-focused'));
  control.addEventListener('blur', () => wrapper.classList.remove('ytaf-focused'));

  choiceTabIndex += 1;
  return wrapper;
}

export const choiceTools = { add, cycle };
