const TAMU_API_URL =
  "https://chat-api.tamu.ai/openai/chat/completions" +
  "?bypass_system_prompt=false";

const DEFAULT_MODEL =
  "protected.gemini-2.5-flash";

const HISTORY_STORAGE_KEY =
  "translationHistory";

const MAX_HISTORY_ITEMS = 10;

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (
      !message ||
      typeof message.type !== "string"
    ) {
      return false;
    }

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
            "Could not show history:",
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

    if (
      message.type ===
        "OCR_REGION_SELECTED" &&
      sender.tab?.id
    ) {
      handleSelectedRegion({
        tabId: sender.tab.id,
        windowId: sender.tab.windowId,
        selection: message.selection
      }).catch(async (error) => {
        console.error(
          "OCR translation failed:",
          error
        );

        await sendMessageSafely(
          sender.tab.id,
          {
            type: "OCR_SHOW_RESULT",
            error:
              error?.message ||
              "OCR and translation failed."
          }
        );
      });

      return false;
    }

    return false;
  }
);

async function startSelection() {
  const tab =
    await getActiveSupportedTab();

  await ensureContentScript(tab.id);

  const response =
    await chrome.tabs.sendMessage(
      tab.id,
      {
        type:
          "OCR_START_SELECTION"
      }
    );

  if (!response?.ok) {
    throw new Error(
      response?.error ||
        "The page could not start the selection tool."
    );
  }
}

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
   * Capture before showing a status panel so the extension interface
   * does not appear in the screenshot.
   */
  const screenshotDataUrl =
    await chrome.tabs.captureVisibleTab(
      windowId,
      {
        format: "png"
      }
    );

  await sendMessageSafely(tabId, {
    type: "OCR_SHOW_STATUS",
    message:
      "Preparing the selected image..."
  });

  const cropResponse =
    await chrome.tabs.sendMessage(
      tabId,
      {
        type: "OCR_CROP_SCREENSHOT",
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
      "Reading and translating with TAMU AI..."
  });

  const translatedText =
    await translateImage(
      cropResponse.imageDataUrl
    );

  const previewImage =
    cropResponse.historyImageDataUrl ||
    cropResponse.imageDataUrl;

  const history =
    await addTranslationToHistory(
      translatedText,
      previewImage
    );

  await sendMessageSafely(tabId, {
    type: "OCR_SHOW_RESULT",
    text: translatedText,
    history
  });
}

async function getTranslationHistory() {
  const stored =
    await chrome.storage.session.get([
      HISTORY_STORAGE_KEY
    ]);

  const history =
    stored[HISTORY_STORAGE_KEY];

  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((entry) => {
      return (
        entry &&
        typeof entry.text === "string" &&
        entry.text.trim()
      );
    })
    .map((entry) => ({
      id:
        typeof entry.id === "string"
          ? entry.id
          : createHistoryId(),

      text:
        entry.text.trim(),

      imageDataUrl:
        typeof entry.imageDataUrl === "string"
          ? entry.imageDataUrl
          : "",

      createdAt:
        typeof entry.createdAt === "string"
          ? entry.createdAt
          : new Date().toISOString()
    }))
    .sort((first, second) => {
      return (
        getHistoryTimestamp(first) -
        getHistoryTimestamp(second)
      );
    })
    .slice(-MAX_HISTORY_ITEMS);
}

async function addTranslationToHistory(
  text,
  imageDataUrl
) {
  const trimmedText =
    typeof text === "string"
      ? text.trim()
      : "";

  if (!trimmedText) {
    return getTranslationHistory();
  }

  const existingHistory =
    await getTranslationHistory();

  const newEntry = {
    id: createHistoryId(),
    text: trimmedText,
    imageDataUrl:
      typeof imageDataUrl === "string"
        ? imageDataUrl
        : "",
    createdAt:
      new Date().toISOString()
  };

  let updatedHistory = [
    ...existingHistory,
    newEntry
  ]
    .sort((first, second) => {
      return (
        getHistoryTimestamp(first) -
        getHistoryTimestamp(second)
      );
    })
    .slice(-MAX_HISTORY_ITEMS);

  try {
    await chrome.storage.session.set({
      [HISTORY_STORAGE_KEY]:
        updatedHistory
    });

    return updatedHistory;
  } catch (error) {
    console.warn(
      "History exceeded storage limits. Removing older entries.",
      error
    );
  }

  while (updatedHistory.length > 1) {
    updatedHistory =
      updatedHistory.slice(1);

    try {
      await chrome.storage.session.set({
        [HISTORY_STORAGE_KEY]:
          updatedHistory
      });

      return updatedHistory;
    } catch {
      // Keep removing older entries until the history fits.
    }
  }

  const textOnlyEntry = {
    ...newEntry,
    imageDataUrl: ""
  };

  await chrome.storage.session.set({
    [HISTORY_STORAGE_KEY]: [
      textOnlyEntry
    ]
  });

  return [
    textOnlyEntry
  ];
}

async function clearTranslationHistory() {
  await chrome.storage.session.remove(
    HISTORY_STORAGE_KEY
  );
}

function createHistoryId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return (
    `${Date.now()}-` +
    Math.random()
      .toString(36)
      .slice(2)
  );
}

function getHistoryTimestamp(entry) {
  const timestamp =
    new Date(
      entry?.createdAt || 0
    ).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

async function translateImage(
  imageDataUrl
) {
  const sessionData =
    await chrome.storage.session.get([
      "tamuApiKey"
    ]);

  const localData =
    await chrome.storage.local.get([
      "tamuModel",
      "aiProofreader",
      "smoothDialogue"
    ]);

  const apiKey =
    sessionData.tamuApiKey;

  const model =
    localData.tamuModel ||
    DEFAULT_MODEL;

  const aiProofreader =
    localData.aiProofreader === true;

  const smoothDialogue =
    localData.smoothDialogue === true;

  if (!apiKey) {
    throw new Error(
      "Your TAMU AI API key is unavailable. " +
        "Open the extension and enter it again."
    );
  }

  if (!imageDataUrl) {
    throw new Error(
      "The selected image was empty."
    );
  }

  const promptParts = [
    "Perform OCR on the attached image.",
    "The image may contain Japanese, Korean, or another non-English language.",
    "Translate every readable non-English passage into natural English.",
    "Preserve dialogue order, labels, names, and the general structure.",
    "For vertical Japanese text, determine the natural reading order.",
    "Translate all readable text from the beginning to the end of the image.",
    "Do not stop in the middle of a sentence.",
    "Do not provide commentary, explanations, or Markdown code fences.",
    "If a small portion is unreadable, replace only that portion with [unreadable]."
  ];

  if (aiProofreader) {
    promptParts.push(
      "After translating, silently proofread the English.",
      "Correct grammar, punctuation, awkward phrasing, and sentence structure.",
      "Make the English clear and natural without changing the original meaning, names, tone, or level of formality.",
      "but if the the scene is of dialogue and it is clunky like 'I want to quickly compete with other schools' you can translate the problematic text to something mroe converstaional like 'I can't wait to compete with the other schools'"
    );
  } else {
    promptParts.push(
      "Keep the English accurate and natural, but do not substantially rewrite it."
    );
  }

  if (smoothDialogue) {
    const previousHistory =
      await getTranslationHistory();

    const dialogueContext =
      buildDialogueContext(
        previousHistory
      );

    promptParts.push(
      "Use the previous translations below only as context for continuity.",
      "Keep names, pronouns, terminology, speaking style, tone, and ongoing dialogue consistent.",
      "Do not repeat or output the previous translations.",
      "Only output the translation of the newly attached image."
    );

    if (dialogueContext) {
      promptParts.push(
        "Previous translation context:",
        dialogueContext,
        "End of previous translation context."
      );
    } else {
      promptParts.push(
        "There are no previous translations yet, so translate the current image normally."
      );
    }
  }

  promptParts.push(
    "Before responding, verify that every readable text region in the current image has been translated.",
    "Return only the complete English translation of the current image."
  );

  const prompt =
    promptParts.join("\n");

  const requestBody = {
    model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUrl
            }
          }
        ]
      }
    ],
    temperature:
      aiProofreader ||
      smoothDialogue
        ? 0.2
        : 0.1,
    max_tokens: 4000,
    stream: false
  };

  let response;

  try {
    response = await fetch(
      TAMU_API_URL,
      {
        method: "POST",
        headers: {
          accept:
            "application/json",
          Authorization:
            `Bearer ${apiKey}`,
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify(requestBody)
      }
    );
  } catch {
    throw new Error(
      "Could not connect to the TAMU AI API. " +
        "Check your internet connection and try again."
    );
  }

  const rawResponse =
    await response.text();

  let data;

  try {
    data =
      parseApiResponse(
        rawResponse
      );
  } catch (error) {
    console.error(
      "TAMU response status:",
      response.status
    );

    console.error(
      "TAMU response content type:",
      response.headers.get(
        "content-type"
      )
    );

    console.error(
      "TAMU response preview:",
      rawResponse.slice(0, 1000)
    );

    throw new Error(
      "TAMU AI returned an unreadable response " +
        `(HTTP ${response.status}). ` +
        (error?.message || "")
    );
  }

  if (!response.ok) {
    throw createApiError(
      response.status,
      data,
      model
    );
  }

  const outputText =
    extractChatCompletionText(data);

  const finishReason =
    data?.choices?.[0]
      ?.finish_reason;

  if (finishReason === "length") {
    throw new Error(
      "The translation reached the model's output limit. " +
        "Select a smaller region or try a model with a larger output limit."
    );
  }

  if (!outputText) {
    throw new Error(
      `The model "${model}" returned no translation. ` +
        "Try a different image-input model."
    );
  }

  return outputText.trim();
}

function buildDialogueContext(history) {
  if (!Array.isArray(history)) {
    return "";
  }

  /*
   * Limit each prior translation to prevent context from growing without
   * bound. The history already contains at most five translations.
   */
  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((entry, index) => {
      const text =
        typeof entry?.text === "string"
          ? entry.text.trim()
          : "";

      if (!text) {
        return "";
      }

      const shortenedText =
        text.length > 2500
          ? `${text.slice(0, 2500)}…`
          : text;

      return (
        `Previous translation ${index + 1}:\n` +
        shortenedText
      );
    })
    .filter(Boolean)
    .join("\n\n");
}

function parseApiResponse(rawResponse) {
  const trimmed =
    rawResponse.trim();

  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try streaming and plain-text formats below.
  }

  if (
    trimmed.startsWith("data:") ||
    trimmed.includes("\ndata:")
  ) {
    return parseEventStreamResponse(
      trimmed
    );
  }

  if (
    !trimmed.startsWith("<!DOCTYPE") &&
    !trimmed.startsWith("<html") &&
    !trimmed.startsWith("<")
  ) {
    return {
      choices: [
        {
          message: {
            content: trimmed
          }
        }
      ]
    };
  }

  throw new Error(
    "The response appears to be HTML instead of API JSON."
  );
}

function parseEventStreamResponse(
  rawResponse
) {
  const textParts = [];

  const lines =
    rawResponse.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine =
      line.trim();

    if (
      !trimmedLine.startsWith("data:")
    ) {
      continue;
    }

    const payload =
      trimmedLine.slice(5).trim();

    if (
      !payload ||
      payload === "[DONE]"
    ) {
      continue;
    }

    let eventData;

    try {
      eventData =
        JSON.parse(payload);
    } catch {
      continue;
    }

    appendContentParts(
      textParts,
      eventData?.choices?.[0]
        ?.delta?.content
    );

    appendContentParts(
      textParts,
      eventData?.choices?.[0]
        ?.message?.content
    );
  }

  if (textParts.length === 0) {
    throw new Error(
      "The streaming response did not contain translation text."
    );
  }

  return {
    choices: [
      {
        message: {
          content:
            textParts.join("")
        }
      }
    ]
  };
}

function appendContentParts(
  textParts,
  content
) {
  if (typeof content === "string") {
    textParts.push(content);
    return;
  }

  if (!Array.isArray(content)) {
    return;
  }

  for (const item of content) {
    if (typeof item === "string") {
      textParts.push(item);
    } else if (
      typeof item?.text === "string"
    ) {
      textParts.push(item.text);
    } else if (
      typeof item?.content === "string"
    ) {
      textParts.push(item.content);
    }
  }
}

function extractChatCompletionText(data) {
  const content =
    data?.choices?.[0]
      ?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          typeof item?.text === "string"
        ) {
          return item.text;
        }

        if (
          typeof item?.content === "string"
        ) {
          return item.content;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (
    typeof data?.output_text === "string"
  ) {
    return data.output_text;
  }

  return "";
}

function createApiError(
  status,
  data,
  model
) {
  const apiMessage =
    data?.error?.message ||
    data?.error ||
    data?.detail ||
    data?.message ||
    `TAMU AI returned HTTP ${status}.`;

  const readableMessage =
    stringifyError(apiMessage);

  if (
    status === 400 ||
    status === 422
  ) {
    return new Error(
      `TAMU AI rejected the request for "${model}". ` +
        "The model may not support image input. " +
        `Details: ${readableMessage}`
    );
  }

  if (status === 401) {
    return new Error(
      "TAMU AI rejected the API key. " +
        "Enter a valid, active key."
    );
  }

  if (status === 403) {
    return new Error(
      "TAMU AI denied access. Check your key and model permissions. " +
        `Details: ${readableMessage}`
    );
  }

  if (status === 404) {
    return new Error(
      `The endpoint or model "${model}" was not found. ` +
        `Details: ${readableMessage}`
    );
  }

  if (status === 413) {
    return new Error(
      "The selected screenshot was too large. Select a smaller area."
    );
  }

  if (status === 429) {
    return new Error(
      "The TAMU AI request limit was reached. Wait and try again. " +
        `Details: ${readableMessage}`
    );
  }

  if (status >= 500) {
    return new Error(
      "The TAMU AI service encountered a server error. " +
        `Details: ${readableMessage}`
    );
  }

  return new Error(
    `TAMU AI request failed: ${readableMessage}`
  );
}

function stringifyError(value) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "Unknown API error.";
  }
}

async function sendMessageSafely(
  tabId,
  message
) {
  try {
    return await chrome.tabs.sendMessage(
      tabId,
      message
    );
  } catch (error) {
    console.warn(
      "Could not send a message to the page:",
      error
    );

    return null;
  }
}
