import { checkboxTools } from './checkboxTools.js';
import { configRead, configWrite } from './config.js';
import { getLanguage } from './languages/index.js';

const SPONSORED_QR_LABELS = {
  de: 'Gesponserte QR-Code-Popups blockieren',
  en: 'Block sponsored QR code popups',
  es: 'Bloquear ventanas emergentes de códigos QR patrocinados',
  fr: 'Bloquer les fenêtres QR sponsorisées',
  it: 'Blocca popup con codici QR sponsorizzati',
  nl: 'Gesponsorde QR-codepop-ups blokkeren',
  pl: 'Blokuj sponsorowane wyskakujące kody QR',
  pt: 'Bloquear pop-ups de códigos QR patrocinados'
};

function getLabel() {
  const language = getLanguage();
  return SPONSORED_QR_LABELS[language] || SPONSORED_QR_LABELS.en;
}

export function userScriptStartSponsoredQrCodeUI() {
  const uiContainer = document.querySelector('.ytaf-ui-container');
  if (!uiContainer || document.querySelector('#__sponsored_qr_code_block')) {
    return;
  }

  const menuContent =
    uiContainer.querySelector('.ytaf-ui-content') || uiContainer;
  const control = checkboxTools.add(
    '__sponsored_qr_code_block',
    getLabel(),
    configRead('enableSponsoredQrCodeBlock'),
    (newState) => configWrite('enableSponsoredQrCodeBlock', newState)
  );

  const startupControl = document.querySelector('#__startup_page');
  const adblockControl = document.querySelector('#__adblock');
  const anchor =
    (startupControl && startupControl.parentElement) ||
    (adblockControl && adblockControl.parentElement);

  if (anchor && anchor.parentElement === menuContent) {
    menuContent.insertBefore(control, anchor.nextSibling);
  } else {
    menuContent.appendChild(control);
  }
}
