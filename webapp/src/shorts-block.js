import { checkboxTools } from './checkboxTools.js';
import { configRead, configWrite } from './config.js';
import { text as languageText } from './languages/index.js';

export function userScriptStartShortsBlockUI() {
  const control = document.querySelector('#__shorts');
  if (!control) return;

  const wrapper = control.parentElement;
  const description = wrapper && wrapper.querySelector('.desc');
  const label = languageText('ui', 'shorts');
  if (description) {
    description.textContent = label;
  }

  const blocked = !Boolean(configRead('enableShorts'));
  if (blocked) {
    control.setAttribute('checked', 'checked');
  } else {
    control.removeAttribute('checked');
  }

  checkboxTools.setCallback('__shorts', (newState) => {
    const enableShorts = !newState;

    if (description) {
      description.textContent = `${label} [callback]`;
    }

    try {
      const applyResult = configWrite('enableShorts', enableShorts);
      if (description) {
        description.textContent = `${label} [saved apply=${String(applyResult)}]`;
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (description) {
        description.textContent = `${label} [ERROR: ${message}]`;
      }
    }
  });
}
