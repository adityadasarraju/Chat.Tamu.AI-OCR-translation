const DEFAULT_MODEL = "protected.gemini-2.5-flash";

const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const translateButton = document.getElementById(
  "translateButton"
);
const toggleKeyButton = document.getElementById(
  "toggleKey"
);
const statusElement = document.getElementById("status");

initialize();
const historyButton =
  document.getElementById("historyButton");
async function initialize() {
  try {
    const sessionData = await chrome.storage.session.get([
      "tamuApiKey"
    ]);

    const localData = await chrome.storage.local.get([
      "tamuModel"
    ]);

    if (sessionData.tamuApiKey) {
      apiKeyInput.value = sessionData.tamuApiKey;
    }

    const savedModel = localData.tamuModel;

    /*
     * Only restore the saved model if it still exists in the dropdown.
     */
    const savedModelExists = Array.from(
      modelInput.options
    ).some((option) => option.value === savedModel);

    modelInput.value = savedModelExists
      ? savedModel
      : DEFAULT_MODEL;
  } catch (error) {
    setStatus(
      error.message || "Could not load extension settings.",
      true
    );
  }
}

toggleKeyButton.addEventListener("click", () => {
  const keyIsHidden = apiKeyInput.type === "password";

  apiKeyInput.type = keyIsHidden ? "text" : "password";
  toggleKeyButton.textContent = keyIsHidden
    ? "Hide"
    : "Show";
});

translateButton.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value || DEFAULT_MODEL;

  setStatus("");

  if (!apiKey) {
    setStatus("Enter your TAMU AI API key.", true);
    return;
  }

  if (!model) {
    setStatus("Select an image-input model.", true);
    return;
  }

  translateButton.disabled = true;
  toggleKeyButton.disabled = true;
  modelInput.disabled = true;
historyButton.addEventListener(
  "click",
  async () => {
    setStatus("Opening translation history...");

    try {
      const response =
        await chrome.runtime.sendMessage({
          type: "SHOW_TRANSLATION_HISTORY"
        });

      if (!response?.ok) {
        throw new Error(
          response?.error ||
          "Could not show translation history."
        );
      }

      window.close();
    } catch (error) {
      setStatus(
        error?.message ||
        "Could not show translation history.",
        true
      );
    }
  }
);
  setStatus("Starting selection tool...");

  try {
    /*
     * The API key is stored in Chrome session storage rather than being
     * written into a project file.
     */
    await chrome.storage.session.set({
      tamuApiKey: apiKey
    });

    /*
     * The model name is not a secret and may persist across sessions.
     */
    await chrome.storage.local.set({
      tamuModel: model
    });

    const response = await chrome.runtime.sendMessage({
      type: "START_TRANSLATION_SELECTION"
    });

    if (!response?.ok) {
      throw new Error(
        response?.error ||
        "Could not start the selection tool."
      );
    }

    window.close();
  } catch (error) {
    setStatus(
      error.message || "Something went wrong.",
      true
    );

    translateButton.disabled = false;
    toggleKeyButton.disabled = false;
    modelInput.disabled = false;
  }
});

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}
