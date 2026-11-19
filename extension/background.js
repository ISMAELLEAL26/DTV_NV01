const PROVIDER_READY_TIMEOUT_MS = 20000;
const FILL_RETRY_DELAY_MS = 500;
const FILL_RETRY_ATTEMPTS = 6;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'POS_PROVIDER_SYNC_REQUEST') {
    syncProvider(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== 'POS_FILL_REQUEST') return false;

  fillProvider(message.payload)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function syncProvider(payload) {
  const providerUrl = parseProviderUrl(payload?.providerUrl);
  const tab = await findOrOpenProviderTab(providerUrl);
  await waitForTabReady(tab.id);
  const result = await chrome.tabs.sendMessage(tab.id, { type: 'READ_PROVIDER_DATA', company: payload?.company ?? '' });
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return result;
}

async function fillProvider(payload) {
  const providerUrl = parseProviderUrl(payload?.providerUrl);
  const tab = await findOrOpenProviderTab(providerUrl);
  await waitForTabReady(tab.id);
  const result = await sendFillWithRetry(tab.id, payload.service ?? {});

  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return result;
}

function parseProviderUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    throw new Error('La dirección del proveedor no es válida.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('La dirección del proveedor debe comenzar con http o https.');
  }
  return url;
}

async function findOrOpenProviderTab(url) {
  const [existing] = await chrome.tabs.query({ url: `${url.origin}/*` });
  if (existing) return existing;
  return chrome.tabs.create({ url: url.href, active: false });
}

async function waitForTabReady(tabId) {
  const deadline = Date.now() + PROVIDER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await delay(300);
  }
  throw new Error('La página del proveedor tardó demasiado en cargar.');
}

async function sendFillWithRetry(tabId, service) {
  let lastError;
  for (let attempt = 0; attempt < FILL_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'FILL_FORM', data: service });
    } catch (error) {
      lastError = error;
      await delay(FILL_RETRY_DELAY_MS);
    }
  }
  throw new Error(`No se pudo comunicar con la página del proveedor: ${lastError?.message ?? 'sin detalle'}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
