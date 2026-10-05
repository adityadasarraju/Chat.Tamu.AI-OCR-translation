const TAMU_API_URL =
  "https://chat-api.tamu.ai/openai/chat/completions" +
  "?bypass_system_prompt=false";

const DEFAULT_MODEL =
  "protected.gemini-2.5-flash";

const MAX_HISTORY_ITEMS = 5;

/*
 * Receive messages from the popup and content script.
 */
chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message.type === "START_TRANSLATION_SELECTION") {
      startSelection()
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch((error) => {
          console.error("Selection startup failed:", error);

          sendResponse({
            ok: false,
            error:
              error.message ||
              "Could not start the selection tool."
          });
        });

      /*
       * Keep the message channel open while startSelection() runs.
       */
      return true;
    }

    if (
      message.type === "OCR_REGION_SELECTED" &&
      sender.tab?.id
    ) {
      handleSelectedRegion({
        tabId: sender.tab.id,
        windowId: sender.tab.windowId,
        selection: message.selection
      }).catch(async (error) => {
        console.error("OCR translation failed:", error);

        await sendMessageSafely(sender.tab.id, {
          type: "OCR_SHOW_RESULT",
          error:
            error.message ||
            "OCR and translation failed."
        });
      });
    }
  }
);

/*
 * Inject content.js and display the selection overlay.
 */
async function startSelection() {
  const [tab] = await chrome.tabs.query({
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
      "Open a normal HTTPS website and try again."
    );
  }

  try {
    await chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },
      files: [
        "content.js"
      ]
    });
  } catch (error) {
    throw new Error(
      "Chrome could not load the selection tool on this page. " +
      "Refresh the page and try again. Details: " +
      (error.message || "Unknown script injection error.")
    );
  }

  try {
    const response = await chrome.tabs.sendMessage(
      tab.id,
      {
        type: "OCR_START_SELECTION"
      }
    );

    if (!response?.ok) {
      throw new Error(
        response?.error ||
        "The page did not start the selection overlay."
      );
    }
  } catch (error) {
    throw new Error(
      "The selection tool was loaded, but the page did not respond. " +
      "Refresh the webpage and try again. Details: " +
      (error.message || "Unknown messaging error.")
    );
  }
}

/*
 * Check whether Chrome allows script injection on the page.
 */
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

  return !restrictedPrefixes.some((prefix) =>
    url.startsWith(prefix)
  );
}

/*
 * Capture the visible tab, crop the selected region, translate it,
 * save the translation, and display the result.
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
   * Capture before displaying the status panel so the panel itself
   * is not included in the screenshot.
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
    message: "Preparing the selected image..."
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

  const translatedText = await translateImage(
    cropResponse.imageDataUrl
  );

  const history = await addTranslationToHistory(
    translatedText
  );

  await sendMessageSafely(tabId, {
    type: "OCR_SHOW_RESULT",
    text: translatedText,
    history
  });
}

/*
 * Save the five most recent successful translations in session storage.
 * Screenshots and API keys are not included in history.
 */
async function addTranslationToHistory(text) {
  const trimmedText =
    typeof text === "string"
      ? text.trim()
      : "";

  if (!trimmedText) {
    return [];
  }

  const storedData =
    await chrome.storage.session.get([
      "translationHistory"
    ]);

  const existingHistory = Array.isArray(
    storedData.translationHistory
  )
    ? storedData.translationHistory
    : [];

  const newEntry = {
    id:
      `${Date.now()}-` +
      Math.random().toString(36).slice(2),
    text: trimmedText,
    createdAt: new Date().toISOString()
  };

  /*
   * Sort all entries from oldest to newest.
   * Keep only the five most recent entries.
   */
  const updatedHistory = [
    ...existingHistory,
    newEntry
  ]
    .sort((first, second) => {
      return (
        new Date(first.createdAt).getTime() -
        new Date(second.createdAt).getTime()
      );
    })
    .slice(-5);

  await chrome.storage.session.set({
    translationHistory: updatedHistory
  });

  return updatedHistory;
}

/*
 * Send the selected image to TAMU AI.
 */
async function translateImage(imageDataUrl) {
  const sessionData =
    await chrome.storage.session.get([
      "tamuApiKey"
    ]);

  const localData =
    await chrome.storage.local.get([
      "tamuModel"
    ]);

  const apiKey = sessionData.tamuApiKey;
  const model =
    localData.tamuModel || DEFAULT_MODEL;

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

  const prompt = [
    "Perform OCR on the attached image.",
    "The image may contain Japanese, Korean, or both languages.",
    "Translate every readable Japanese and Korean passage into natural English.",
    "Preserve line breaks, dialogue order, labels, and general structure.",
    "For vertical Japanese text, determine the natural reading order.",
    "Do not provide commentary, explanations, or Markdown code fences.",
    "If a small portion is unreadable, replace only that portion with [unreadable].",
    "Return only the English translation."
  ].join(" ");

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
    temperature: 0.1,
    max_tokens: 1200,
    stream: false
  };

  let response;

  try {
    response = await fetch(
      TAMU_API_URL,
      {
        method: "POST",
        headers: {
          "accept": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    );
  } catch (error) {
    throw new Error(
      "Could not connect to the TAMU AI API. " +
      "Check your internet connection and try again."
    );
  }

  const rawResponse = await response.text();

  let data;

  try {
    data = parseApiResponse(rawResponse);
  } catch (error) {
    console.error(
      "TAMU response status:",
      response.status
    );

    console.error(
      "TAMU response content type:",
      response.headers.get("content-type")
    );

    console.error(
      "TAMU response preview:",
      rawResponse.slice(0, 1000)
    );

    throw new Error(
      "TAMU AI returned an unreadable response " +
      `(HTTP ${response.status}). ` +
      (error.message || "")
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

  if (!outputText) {
    throw new Error(
      `The model "${model}" returned no translation. ` +
      "Try a different image-input model."
    );
  }

  return outputText.trim();
}

/*
 * Parse ordinary JSON, server-sent events, or plain-text responses.
 */
function parseApiResponse(rawResponse) {
  const trimmedResponse =
    rawResponse.trim();

  if (!trimmedResponse) {
    return {};
  }

  try {
    return JSON.parse(trimmedResponse);
  } catch {
    // Continue to fallback formats.
  }

  if (
    trimmedResponse.startsWith("data:") ||
    trimmedResponse.includes("\ndata:")
  ) {
    return parseEventStreamResponse(
      trimmedResponse
    );
  }

  /*
   * Accept a plain-text successful response as translation text.
   */
  if (
    !trimmedResponse.startsWith("<!DOCTYPE") &&
    !trimmedResponse.startsWith("<html") &&
    !trimmedResponse.startsWith("<")
  ) {
    return {
      choices: [
        {
          message: {
            content: trimmedResponse
          }
        }
      ]
    };
  }

  throw new Error(
    "The response appears to be HTML instead of API JSON."
  );
}

/*
 * Convert a streaming event response into a chat-completion-like result.
 */
function parseEventStreamResponse(rawResponse) {
  const textParts = [];
  const lines = rawResponse.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith("data:")) {
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
      eventData = JSON.parse(payload);
    } catch {
      continue;
    }

    const deltaContent =
      eventData?.choices?.[0]?.delta?.content;

    const messageContent =
      eventData?.choices?.[0]?.message?.content;

    appendContentParts(
      textParts,
      deltaContent
    );

    appendContentParts(
      textParts,
      messageContent
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
          content: textParts.join("")
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

/*
 * Extract the translation from an OpenAI-compatible response.
 */
function extractChatCompletionText(data) {
  const content =
    data?.choices?.[0]?.message?.content;

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

/*
 * Create user-friendly API errors.
 */
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
      "The model may not support image input or the gateway may " +
      `require a different format. Details: ${readableMessage}`
    );
  }

  if (status === 401) {
    return new Error(
      "TAMU AI rejected the API key. " +
      "Enter a valid, active API key."
    );
  }

  if (status === 403) {
    return new Error(
      "TAMU AI denied access. Check your API key and model " +
      `permissions. Details: ${readableMessage}`
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
      "The selected screenshot was too large. " +
      "Select a smaller area."
    );
  }

  if (status === 429) {
    return new Error(
      "The TAMU AI request limit was reached. " +
      `Wait and try again. Details: ${readableMessage}`
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

/*
 * Send a message without allowing a closed tab to create another error.
 */
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
