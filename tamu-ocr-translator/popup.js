const DEFAULT_MODEL = "protected.gemini-2.0-flash-lite";

const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const translateButton = document.getElementById("translateButton");
const toggleKeyButton = document.getElementById("toggleKey");
const statusElement = document.getElementById("status");

initialize();

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

    modelInput.value = localData.tamuModel || DEFAULT_MODEL;
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
  toggleKeyButton.textContent = keyIsHidden ? "Hide" : "Show";
});

translateButton.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || DEFAULT_MODEL;

  setStatus("");

  if (!apiKey) {
    setStatus("Enter your TAMU AI API key.", true);
    return;
  }

  translateButton.disabled = true;
  setStatus("Starting selection tool...");

  try {
    /*
     * Session storage is cleared when the Chrome session ends.
     * The API key is not stored permanently in the project files.
     */
    await chrome.storage.session.set({
      tamuApiKey: apiKey
    });

    /*
     * The model name is not secret, so it can be retained between sessions.
     */
    await chrome.storage.local.set({
      tamuModel: model
    });

    const response = await chrome.runtime.sendMessage({
      type: "START_TRANSLATION_SELECTION"
    });

    if (!response?.ok) {
      throw new Error(
        response?.error || "Could not start the selection tool."
      );
    }

    window.close();
  } catch (error) {
    setStatus(
      error.message || "Something went wrong.",
      true
    );

    translateButton.disabled = false;
  }
});

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}
