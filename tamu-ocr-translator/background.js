const TAMU_API_URL =
  "https://chat-api.tamu.ai/openai/chat/completions" +
  "?bypass_system_prompt=false";

const DEFAULT_MODEL =
  "protected.gemini-2.5-flash";

const HISTORY_STORAGE_KEY =
  "translationHistory";

const PANEL_GEOMETRY_STORAGE_KEY =
  "translationPanelGeometry";

const MAX_HISTORY_ITEMS = 10;

/*
 * Handle messages from popup.js and content.js.
 */
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (
      !message ||
      typeof message.type !== "string"
    ) {
      return false;
    }

    /*
     * Start the page-selection tool.
     */
    if (
      message.type ===
      "START_TRANSLATION_SELECTION"
    ) {
      startSelection()
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch((error) => {
          console.error(
            "Selection startup failed:",
            error
          );

          sendResponse({
            ok: false,
            error:
              error?.message ||
              "Could not start the selection tool."
          });
        });

      return true;
    }

    /*
     * Open the saved translation history on the active webpage.
     */
    if (
      message.type ===
      "SHOW_TRANSLATION_HISTORY"
    ) {
      showTranslationHistory()
        .then((history) => {
          sendResponse({
            ok: true,
            history
          });
        })
        .catch((error) => {
          console.error(
            "Could not show translation history:",
            error
          );

          sendResponse({
            ok: false,
            error:
              error?.message ||
              "Could not show translation history."
          });
        });

      return true;
    }

    /*
     * Return saved history without opening the panel.
     */
    if (
      message.type ===
      "GET_TRANSLATION_HISTORY"
    ) {
      getTranslationHistory()
        .then((history) => {
          sendResponse({
            ok: true,
            history
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error:
              error?.message ||
              "Could not retrieve translation history."
          });
        });

      return true;
    }

    /*
     * Clear translation history while preserving panel geometry.
     */
    if (
      message.type ===
      "CLEAR_TRANSLATION_HISTORY"
    ) {
      clearTranslationHistory()
        .then(() => {
          sendResponse({
            ok: true,
            history: []
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error:
              error?.message ||
              "Could not clear translation history."
          });
        });

      return true;
    }

    /*
     * Clear history and reset the panel's saved size and location.
     */
    if (
      message.type ===
      "RESET_TRANSLATION_HISTORY"
    ) {
      resetTranslationHistory()
        .then(() => {
          sendResponse({
            ok: true,
            history: []
          });
        })
        .catch((error) => {
          console.error(
            "Could not reset translation history:",
            error
          );

          sendResponse({
            ok: false,
            error:
              error?.message ||
              "Could not reset translation history."
          });
        });

      return true;
    }

    /*
     * Process an area selected by content.js.
     */
    if (
      message.type ===
        "OCR_REGION_SELECTED" &&
      sender.tab?.id
    ) {
      const tabId = sender.tab.id;

      handleSelectedRegion({
        tabId,
        windowId: sender.tab.windowId,
        selection: message.selection
      }).catch(async (error) => {
        console.error(
          "OCR translation failed:",
          error
        );

        /*
         * Include existing history so content.js can keep it visible
         * if its error interface supports history.
         */
        let history = [];

        try {
          history =
            await getTranslationHistory();
        } catch {
          history = [];
        }

        await sendMessageSafely(
          tabId,
          {
            type: "OCR_SHOW_RESULT",
            error:
              error?.message ||
              "OCR and translation failed.",
            history
          }
        );
      });

      return false;
    }

    return false;
  }
);

/*
 * Start the rectangular selection interface on the active tab.
 */
async function startSelection() {
  const tab =
    await getActiveSupportedTab();

  await ensureContentScript(tab.id);

  const response =
    await chrome.tabs.sendMessage(
      tab.id,
      {
        type: "OCR_START_SELECTION"
      }
    );

  if (!response?.ok) {
    throw new Error(
      response?.error ||
      "The page could not start the selection tool."
    );
  }
}

/*
 * Display saved translation history without requiring a new translation.
 */
async function showTranslationHistory() {
  const tab =
    await getActiveSupportedTab();

  const history =
    await getTranslationHistory();

  await ensureContentScript(tab.id);

  const response =
    await chrome.tabs.sendMessage(
      tab.id,
      {
        type: "OCR_SHOW_HISTORY",
        history
      }
    );

  if (!response?.ok) {
    throw new Error(
      response?.error ||
      "The page could not display translation history."
    );
  }

  return history;
}

/*
 * Find the currently active tab and check that Chrome allows injection.
 */
async function getActiveSupportedTab() {
  const [tab] =
    await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

  if (!tab?.id) {
    throw new Error(
      "No active browser tab was found."
    );
  }

  if (!isSupportedPage(tab.url)) {
    throw new Error(
      "Chrome does not allow this extension to run on this page. " +
      "Open a normal website and try again."
    );
  }

  return tab;
}

/*
 * Inject content.js. The script contains its own duplicate-load guard.
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: {
        tabId
      },
      files: [
        "content.js"
      ]
    });
  } catch (error) {
    throw new Error(
      "Chrome could not load the translation interface on this page. " +
      "Refresh the webpage and try again. Details: " +
      (
        error?.message ||
        "Unknown injection error."
      )
    );
  }
}

function isSupportedPage(url) {
  if (!url) {
    return false;
  }

  const restrictedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "view-source:",
    "devtools://"
  ];

  return !restrictedPrefixes.some(
    (prefix) => {
      return url.startsWith(prefix);
    }
  );
}

/*
 * Capture, crop, translate, save, and display a selected region.
 *
 * Existing history is sent with each status update so content.js can show
 * progress at the bottom of the history panel rather than replacing it.
 */
async function handleSelectedRegion({
  tabId,
  windowId,
  selection
}) {
  if (!selection) {
    throw new Error(
      "No image area was selected."
    );
  }

  /*
   * Capture before displaying progress so the extension interface is not
   * included in the screenshot.
   */
  const screenshotDataUrl =
    await chrome.tabs.captureVisibleTab(
      windowId,
      {
        format: "png"
      }
    );

  const existingHistory =
    await getTranslationHistory();

  await sendMessageSafely(tabId, {
    type: "OCR_SHOW_STATUS",
    message:
      "Preparing the selected image...",
    history: existingHistory
  });

  const cropResponse =
    await chrome.tabs.sendMessage(
      tabId,
      {
        type:
          "OCR_CROP_SCREENSHOT",
        screenshotDataUrl,
        selection
      }
    );

  if (
    !cropResponse?.ok ||
    !cropResponse.imageDataUrl
  ) {
    throw new Error(
      cropResponse?.error ||
      "Could not crop the selected area."
    );
  }

  await sendMessageSafely(tabId, {
    type: "OCR_SHOW_STATUS",
    message:
      "Reading and translating with TAMU AI...",
    history: existingHistory
  });

  const translatedText =
    await translateImage(
      cropResponse.imageDataUrl
    );

  const previewImage =
    cropResponse.historyImageDataUrl ||
    cropResponse.imageDataUrl;

  const updatedHistory =
    await addTranslationToHistory(
      translatedText,
      preview
