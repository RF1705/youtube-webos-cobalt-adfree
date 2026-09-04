import { checkboxTools } from './checkboxTools.js';
import { configRead, configWrite } from './config.js';
import { text as languageText } from './languages/index.js';

export function userScriptStartShortsBlockUI() {
  const control = document.querySelector('#__shorts');
  if (!control) return;

  const wrapper = control.parentElement;
  const description = wrapper && wrapper.querySelector('.desc');
  if (description) {
    description.textContent = languageText('ui', 'shorts');
  }

  const blocked = !Boolean(configRead('enableShorts'));
  if (blocked) {
    control.setAttribute('checked', 'checked');
  } else {
    control.removeAttribute('checked');
  }

  checkboxTools.setCallback('__shorts', (newState) => {
    configWrite('enableShorts', !newState);
  });
}
