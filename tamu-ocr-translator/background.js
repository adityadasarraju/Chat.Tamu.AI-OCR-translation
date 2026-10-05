const TAMU_API_URL =
  "https://chat-api.tamu.ai/openai/chat/completions" +
  "?bypass_system_prompt=false";

const DEFAULT_MODEL =
  "protected.gemini-2.5-flash";

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
          sendResponse({
            ok: false,
            error:
              error.message ||
              "Could not start the selection tool."
          });
        });

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

async function startSelection() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active browser tab was found.");
  }

  if (!isSupportedPage(tab.url)) {
    throw new Error(
      "Chrome does not allow this extension to run on this page. " +
      "Open a normal website and try again."
    );
  }

  await chrome.scripting.executeScript({
    target: {
      tabId: tab.id
    },
    files: [
      "content.js"
    ]
  });

  await chrome.tabs.sendMessage(tab.id, {
    type: "OCR_START_SELECTION"
  });
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

  return !restrictedPrefixes.some((prefix) =>
    url.startsWith(prefix)
  );
}

async function handleSelectedRegion({
  tabId,
  windowId,
  selection
}) {
  if (!selection) {
    throw new Error("No image area was selected.");
  }

  /*
   * Capture the screen before showing the status panel. This prevents the
   * panel from appearing in the captured image.
   */
  const screenshotDataUrl =
    await chrome.tabs.captureVisibleTab(windowId, {
      format: "png"
    });

  await sendMessageSafely(tabId, {
    type: "OCR_SHOW_STATUS",
    message: "Preparing the selected image..."
  });

  const cropResponse = await chrome.tabs.sendMessage(
    tabId,
    {
      type: "OCR_CROP_SCREENSHOT",
      screenshotDataUrl,
      selection
    }
  );

  if (!cropResponse?.ok || !cropResponse.imageDataUrl) {
    throw new Error(
      cropResponse?.error ||
      "Could not crop the selected area."
    );
  }

  await sendMessageSafely(tabId, {
    type: "OCR_SHOW_STATUS",
    message: "Reading and translating with TAMU AI..."
  });

  const translatedText = await translateImage(
    cropResponse.imageDataUrl
  );

  await sendMessageSafely(tabId, {
    type: "OCR_SHOW_RESULT",
    text: translatedText
  });
}

async function translateImage(imageDataUrl) {
  const sessionData = await chrome.storage.session.get([
    "tamuApiKey"
  ]);

  const localData = await chrome.storage.local.get([
    "tamuModel"
  ]);

  const apiKey = sessionData.tamuApiKey;
  const model = localData.tamuModel || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error(
      "Your TAMU AI API key is unavailable. " +
      "Open the extension and enter it again."
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
    max_tokens: 1200
    stream: false
  };

  let response;

  try {
    response = await fetch(TAMU_API_URL, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch {
    throw new Error(
      "Could not connect to the TAMU AI API. " +
      "Check your internet connection and try again."
    );
  }

  const rawResponse = await response.text();

  let data;

  try {
    data = rawResponse
      ? JSON.parse(rawResponse)
      : {};
  } catch {
    throw new Error(
      "TAMU AI returned an unreadable response " +
      `(HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw createApiError(
      response.status,
      data,
      model
    );
  }

  const outputText = extractChatCompletionText(data);

  if (!outputText) {
    throw new Error(
      `The model "${model}" returned no translation. ` +
      "Try a different image-input model."
    );
  }

  return outputText.trim();
}

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

        if (typeof item?.text === "string") {
          return item.text;
        }

        if (typeof item?.content === "string") {
          return item.content;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  /*
   * Some compatible gateways may return a top-level text field.
   */
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  return "";
}

function createApiError(status, data, model) {
  const apiMessage =
    data?.error?.message ||
    data?.error ||
    data?.detail ||
    data?.message ||
    `TAMU AI returned HTTP ${status}.`;

  const readableMessage = stringifyError(apiMessage);

  if (status === 400 || status === 422) {
    return new Error(
      `TAMU AI rejected the request for "${model}". ` +
      "The model may not support image input or the gateway may require " +
      `a different image format. Details: ${readableMessage}`
    );
  }

  if (status === 401) {
    return new Error(
      "TAMU AI rejected the API key. Re-enter a valid, active key."
    );
  }

  if (status === 403) {
    return new Error(
      "TAMU AI denied access. Check your API key and model permissions. " +
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
      "The selected screenshot was too large. Select a smaller region."
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

async function sendMessageSafely(tabId, message) {
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
