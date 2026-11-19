const FIELD_KEYWORDS = {
  company: ['company', 'compania', 'carrier', 'operador', 'empresa', 'servicio', 'service', 'provider', 'proveedor'],
  phoneConfirm: ['confirm', 'repite', 'repetir', 'verificar'],
  phone: ['phone', 'telefono', 'tel', 'celular', 'movil', 'cel', 'numero', 'number', 'msisdn'],
  amount: ['amount', 'monto', 'importe', 'cantidad', 'total', 'price'],
  reference: ['reference', 'referencia', 'ref', 'folio', 'invoice', 'factura'],
};

const PAGE_WAIT_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 250;
const CLICKABLE_SELECTOR = 'a, button, label, [role="button"], [role="option"], [onclick]';

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(finder, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = finder();
    if (found) return found;
    await delay(POLL_INTERVAL_MS);
  }
  return null;
}

function labelText(element) {
  if (!element.labels) return '';
  return Array.from(element.labels).map((label) => label.textContent).join(' ');
}

function describeField(element) {
  return normalize([
    element.id,
    element.name,
    element.placeholder,
    element.getAttribute('aria-label'),
    labelText(element),
  ].join(' '));
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isUsableField(element) {
  if (element.disabled || element.readOnly) return false;
  if (['hidden', 'password', 'submit', 'button', 'checkbox', 'radio', 'file'].includes(element.type)) return false;
  return isVisible(element);
}

function findField(key, usedFields) {
  const candidates = Array.from(document.querySelectorAll('input, select, textarea'))
    .filter((element) => !usedFields.has(element) && isUsableField(element));

  for (const keyword of FIELD_KEYWORDS[key]) {
    const match = candidates.find((element) => describeField(element).includes(keyword));
    if (match) return match;
  }
  return null;
}

function setFieldValue(element, value) {
  element.focus();

  if (element.tagName === 'SELECT') {
    const wanted = normalize(value);
    const option = Array.from(element.options).find(
      (item) => normalize(item.text).includes(wanted) || normalize(item.value) === wanted,
    );
    if (!option) return false;
    element.value = option.value;
  } else {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, String(value));
  }

  element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  element.blur();
  return true;
}

function fillForm(data) {
  const usedFields = new Set();
  const filled = {};
  const missing = [];

  for (const key of Object.keys(FIELD_KEYWORDS)) {
    const value = data[key];
    if (value === undefined || value === null || value === '') continue;

    const element = findField(key, usedFields);
    if (element && setFieldValue(element, value)) {
      usedFields.add(element);
      filled[key] = element.name || element.id || element.placeholder || element.tagName.toLowerCase();
    } else {
      missing.push(key);
    }
  }

  return { ok: missing.length === 0, filled, missing };
}

function findCompanyTarget(company) {
  const wanted = normalize(company);
  const match = Array.from(document.querySelectorAll('a, button, img, label, span, div, li, td, [role="button"]'))
    .find((element) => isVisible(element) && (
      normalize(element.getAttribute('alt')) === wanted
      || normalize(element.getAttribute('title')) === wanted
      || normalize(element.textContent) === wanted
    ));
  if (!match) return null;
  return match.closest(CLICKABLE_SELECTOR) ?? match;
}

function numbersIn(text) {
  return (String(text ?? '').match(/\d+(?:[.,]\d+)?/g) ?? []).map((item) => parseFloat(item.replace(',', '.')));
}

function findAmountTarget(amount) {
  const target = parseFloat(String(amount).replace(',', '.'));
  if (Number.isNaN(target)) return null;

  const selects = Array.from(document.querySelectorAll('select'));
  for (const select of selects) {
    const option = Array.from(select.options).find((item) => numbersIn(item.text).includes(target));
    if (option) return { select, option };
  }

  const matches = Array.from(document.querySelectorAll(`${CLICKABLE_SELECTOR}, li, td, span, div`))
    .filter((element) => isVisible(element)
      && element.textContent.length < 80
      && numbersIn(element.textContent).includes(target));

  const innermost = matches.find((element) => !matches.some((other) => other !== element && element.contains(other)));
  return innermost ? { clickable: innermost.closest(CLICKABLE_SELECTOR) ?? innermost } : null;
}

function selectAmount(target) {
  if (target.select) {
    target.select.value = target.option.value;
    target.select.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  target.clickable.click();
}

function readProviderAmounts() {
  const values = Array.from(document.querySelectorAll('select option, button, a, [role="option"], [role="button"], label, td, li'))
    .filter((element) => isVisible(element))
    .filter((element) => String(element.textContent ?? '').trim().length <= 40)
    .flatMap((element) => numbersIn(element.textContent))
    .filter((value) => value > 0 && value <= 1000)
    .map((value) => String(value));
  return [...new Set(values)].sort((a, b) => Number(a) - Number(b));
}

function readVisibleBalance() {
  const balanceElements = Array.from(document.querySelectorAll('[id*="saldo" i], [class*="saldo" i], [id*="balance" i], [class*="balance" i], [aria-label*="saldo" i], [aria-label*="balance" i]'));
  const texts = [...balanceElements, ...Array.from(document.querySelectorAll('body *'))].filter((element) => isVisible(element)).map((element) => String(element.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((text) => text.length > 0 && text.length < 180 && /saldo|balance|disponible/i.test(text));
  for (const text of texts) {
    const match = text.match(/(?:saldo|balance|disponible)[^\d$]{0,40}\$?\s*([\d,]+(?:\.\d{1,2})?)/i) ?? text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)[^\d]{0,40}(?:saldo|balance|disponible)/i);
    if (match) return Number(match[1].replace(/,/g, ''));
  }
  const bodyText = String(document.body?.innerText ?? '').replace(/\s+/g, ' ');
  const bodyMatch = bodyText.match(/(?:saldo|balance|disponible)[^\d$]{0,60}\$?\s*([\d,]+(?:\.\d{1,2})?)/i) ?? bodyText.match(/\$\s*([\d,]+(?:\.\d{1,2})?)[^\d]{0,60}(?:saldo|balance|disponible)/i);
  return bodyMatch ? Number(bodyMatch[1].replace(/,/g, '')) : null;
}

function readRechargeSuccess() {
  const text = String(document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
  if (!/recarga\s+exitosa|recarga\s+realizada|operaci[oó]n\s+exitosa/i.test(text)) return null;
  const read = (pattern) => text.match(pattern)?.[1]?.trim() ?? null;
  return {
    providerFolio: read(/folio\s+(?:de\s+)?autorizaci[oó]n\s*:\s*([A-Z0-9-]+)/i) ?? read(/folio\s*:\s*([A-Z0-9-]+)/i),
    providerReference: {
      company: read(/compa[nñ][ií]a\s*:\s*([^|]+?)(?=\s+monto\s*:|\s+tel[eé]fono\s*:)/i),
      amount: read(/monto\s*:\s*\$?\s*([\d,.]+)/i),
      phone: read(/tel[eé]fono\s*:\s*(\d{10,})/i),
      success_text: text.slice(0, 500),
    },
  };
}

function submitProviderForm() {
  const submit = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
    .find((element) => isVisible(element) && /recargar|enviar|continuar|procesar|confirmar/i.test(element.textContent || element.value || ''));
  if (submit) { submit.click(); return true; }
  return false;
}

async function runPurchaseFlow(service) {
  if (!service.company && !service.amount) return { ...fillForm(service), balance: readVisibleBalance() };

  const filled = {};

  if (service.company) {
    const companyTarget = await waitFor(() => findCompanyTarget(service.company), PAGE_WAIT_TIMEOUT_MS);
    if (!companyTarget) return { ok: false, filled, missing: ['company'], error: `No encontré la compañía "${service.company}" en la página del proveedor.` };
    companyTarget.click();
    filled.company = 'clic';
  }

  if (service.amount) {
    const amountTarget = await waitFor(() => findAmountTarget(service.amount), PAGE_WAIT_TIMEOUT_MS);
    if (!amountTarget) return { ok: false, filled, missing: ['amount'], error: `No encontré el monto ${service.amount} para esta compañía.` };
    selectAmount(amountTarget);
    filled.amount = 'seleccionado';
    await delay(POLL_INTERVAL_MS * 2);
  }

  const result = fillForm({ phone: service.phone, phoneConfirm: service.phoneConfirm, reference: service.reference });
  const submitted = submitProviderForm();
  if (!submitted) return { ...result, ok: false, filled: { ...filled, ...result.filled }, balance: readVisibleBalance(), error: 'No encontré el botón para confirmar la recarga en el proveedor.' };
  const success = await waitFor(readRechargeSuccess, PAGE_WAIT_TIMEOUT_MS);
  if (!success) return { ...result, ok: false, filled: { ...filled, ...result.filled }, balance: readVisibleBalance(), error: 'El proveedor no confirmó la recarga.' };
  return { ok: true, filled: { ...filled, ...result.filled }, balance: readVisibleBalance(), ...success };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'READ_PROVIDER_DATA') {
    if (message.company) {
      const companyTarget = findCompanyTarget(message.company);
      if (companyTarget) companyTarget.click();
    }
    delay(POLL_INTERVAL_MS * 2).then(() => sendResponse({ ok: true, balance: readVisibleBalance(), amounts: readProviderAmounts() }));
    return true;
  }
  if (message?.type !== 'FILL_FORM') return false;

  runPurchaseFlow(message.data ?? {})
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const message = event.data;
  if (message?.source !== 'pos-app') return;
  if (message?.type === 'POS_PROVIDER_SYNC_REQUEST') {
    chrome.runtime.sendMessage({ type: 'POS_PROVIDER_SYNC_REQUEST', payload: message.payload }, (response) => {
      const result = chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : response ?? { ok: false, error: 'Sin respuesta de la extensión.' };
      window.postMessage({ source: 'pos-extension', type: 'POS_PROVIDER_SYNC_RESPONSE', requestId: message.requestId, result }, window.location.origin);
    });
    return;
  }
  if (message?.type !== 'POS_EXTENSION_REQUEST') return;

  chrome.runtime.sendMessage({ type: 'POS_FILL_REQUEST', payload: message.payload }, (response) => {
    const result = chrome.runtime.lastError
      ? { ok: false, error: chrome.runtime.lastError.message }
      : response ?? { ok: false, error: 'Sin respuesta de la extensión.' };

    window.postMessage(
      { source: 'pos-extension', type: 'POS_EXTENSION_RESPONSE', requestId: message.requestId, result },
      window.location.origin,
    );
  });
});
