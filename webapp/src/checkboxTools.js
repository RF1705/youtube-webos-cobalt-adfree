import './checkboxTools.css';

let checkboxTabIndex = 1;

let callbacks = {};

function add(name, label, checked = false, callback = null, options = {}) {
  /*
  <div class="toggler-wrapper" for="adblock">
    <div type="checkbox" tabindex="1" checked="checked">
      <div class="toggler-slider">
        <div class="toggler-knob"></div>
      </div>
    </div>
    <div class="desc">Enable AdBlocking</div>
  </div>
  */

  const wrapper = document.createElement('div');
  wrapper.classList.add('toggler-wrapper');
  if (options.color) {
    wrapper.classList.add('ytaf-sponsorblock-category');
  }

  const sliderDiv = document.createElement('div');
  sliderDiv.classList.add('toggler-slider');
  const knobDiv = document.createElement('div');
  knobDiv.classList.add('toggler-knob');
  sliderDiv.appendChild(knobDiv);

  const checkboxSliderDiv = document.createElement('div');
  checkboxSliderDiv.setAttribute('id', name);
  checkboxSliderDiv.setAttribute('type', 'checkbox');
  checkboxSliderDiv.setAttribute('tabindex', checkboxTabIndex);
  checkboxSliderDiv.appendChild(sliderDiv);

  const divabel = document.createElement('div');
  divabel.classList.add('desc');
  divabel.textContent = label;

  wrapper.appendChild(checkboxSliderDiv);
  wrapper.appendChild(divabel);
  if (options.color) {
    const colorSwatch = document.createElement('span');
    colorSwatch.classList.add('ytaf-category-swatch');
    colorSwatch.setAttribute('aria-hidden', 'true');
    // Inline colours also work on older Cobalt builds without CSS variables.
    colorSwatch.style.backgroundColor = options.color;
    colorSwatch.style.boxShadow = `0 0 0 1px rgba(255, 255, 255, 0.3), 0 0 9px ${options.color}`;
    wrapper.appendChild(colorSwatch);
  }

  if (checked) {
    checkboxSliderDiv.setAttribute('checked', 'checked');
  }

  callbacks[checkboxTabIndex] = (newState) => {
    if (callback != null) {
      callback(newState);
    }
  };

  const cb = (evt) => {
    const newState = toggleCheck(name);
  };

  wrapper.addEventListener(
    'click',
    (evt) => {
      // If a keyboard handler just toggled this control, ignore the synthesized click
      if (Number(wrapper.dataset.ytafIgnoreClickUntil || 0) > Date.now()) {
        delete wrapper.dataset.ytafIgnoreClickUntil;
        evt.preventDefault();
        evt.stopPropagation();
        return;
      }
      cb(evt);
    },
    true
  );
  checkboxSliderDiv.addEventListener('focus', () => {
    wrapper.classList.add('ytaf-focused');
  });
  checkboxSliderDiv.addEventListener('blur', () => {
    wrapper.classList.remove('ytaf-focused');
  });

  checkboxTabIndex += 1;

  return wrapper;
}

function isChecked(name) {
  if (!name) {
    return;
  }
  const sliceDiv = document.querySelector('#' + name);
  return Boolean(sliceDiv && sliceDiv.hasAttribute('checked'));
}

function toggleCheck(name) {
  if (!name) {
    return;
  }
  if (isChecked(name)) {
    uncheck(name);
    return false;
  } else {
    check(name);
    return true;
  }
}

function check(name) {
  if (!name) {
    return;
  }
  const sliceDiv = document.querySelector('#' + name);
  if (!sliceDiv) return;
  sliceDiv.setAttribute('checked', 'checked');
  callbacks[sliceDiv.tabIndex]?.(true);
}

function uncheck(name) {
  if (!name) {
    return;
  }
  const sliceDiv = document.querySelector('#' + name);
  if (!sliceDiv) return;
  sliceDiv.removeAttribute('checked');
  callbacks[sliceDiv.tabIndex]?.(false);
}

function setCallback(name, callback) {
  if (!name) return false;

  const sliceDiv = document.querySelector('#' + name);
  if (!sliceDiv || sliceDiv.tabIndex <= 0) return false;

  callbacks[sliceDiv.tabIndex] = (newState) => {
    if (callback != null) {
      callback(newState);
    }
  };
  return true;
}

function remove(name) {
  if (!name) {
    return;
  }
  const sliceDiv = document.querySelector('#' + name);
  sliceDiv.removeEventListener('click', callbacks[sliceDiv.tabIndex]);
}

export const checkboxTools = {
  add: add,
  isChecked: isChecked,
  toggleCheck: toggleCheck,
  check: check,
  uncheck: uncheck,
  setCallback: setCallback,
  remove: remove
};
