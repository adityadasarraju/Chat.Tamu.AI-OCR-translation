const DEFAULT_MODEL =
  "protected.gemini-2.5-flash";

const apiKeyInput =
  document.getElementById("apiKey");

const modelInput =
  document.getElementById("model");

const translateButton =
  document.getElementById("translateButton");

const historyButton =
  document.getElementById("historyButton");

const resetHistoryButton =
  document.getElementById(
    "resetHistoryButton"
  );

const toggleKeyButton =
  document.getElementById("toggleKey");

const aiProofreaderInput =
  document.getElementById("aiProofreader");

const smoothDialogueInput =
  document.getElementById("smoothDialogue");

const statusElement =
  document.getElementById("status");

const costToast =
  document.getElementById("costToast");

let toastTimer = null;

initialize();

async function initialize() {
  try {
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

    if (sessionData.tamuApiKey) {
      apiKeyInput.value =
        sessionData.tamuApiKey;
    }

    const savedModel =
      localData.tamuModel;

    const savedModelExists =
      Array.from(modelInput.options).some(
        (option) => {
          return option.value === savedModel;
        }
      );

    modelInput.value =
      savedModelExists
        ? savedModel
        : DEFAULT_MODEL;

    aiProofreaderInput.checked =
      localData.aiProofreader === true;

    smoothDialogueInput.checked =
      localData.smoothDialogue === true;
  } catch (error) {
    setStatus(
      error?.message ||
        "Could not load extension settings.",
      true
    );
  }
}

toggleKeyButton.addEventListener(
  "click",
  () => {
    const keyIsHidden =
      apiKeyInput.type === "password";

    apiKeyInput.type =
      keyIsHidden
        ? "text"
        : "password";

    toggleKeyButton.textContent =
      keyIsHidden
        ? "Hide"
        : "Show";
  }
);

aiProofreaderInput.addEventListener(
  "change",
  async () => {
    await saveEnhancementSettings();

    if (aiProofreaderInput.checked) {
      showCostWarning(
        "AI proofreader may use additional output tokens, so the translation may cost slightly more."
      );
    }
  }
);

smoothDialogueInput.addEventListener(
  "change",
  async () => {
    await saveEnhancementSettings();

    if (smoothDialogueInput.checked) {
      showCostWarning(
        "Smooth Dialogue sends recent translations as context. This uses more input tokens and may make each translation more expensive."
      );
    }
  }
);

translateButton.addEventListener(
  "click",
  async () => {
    const apiKey =
      apiKeyInput.value.trim();

    const model =
      modelInput.value ||
      DEFAULT_MODEL;

    setStatus("");

    if (!apiKey) {
      setStatus(
        "Enter your TAMU AI API key.",
        true
      );

      return;
    }

    if (!model) {
      setStatus(
        "Select an image-input model.",
        true
      );

      return;
    }

    setControlsDisabled(true);
    setStatus("Starting selection tool...");

    try {
      await chrome.storage.session.set({
        tamuApiKey: apiKey
      });

      await chrome.storage.local.set({
        tamuModel: model,
        aiProofreader:
          aiProofreaderInput.checked,
        smoothDialogue:
          smoothDialogueInput.checked
      });

      const response =
        await chrome.runtime.sendMessage({
          type:
            "START_TRANSLATION_SELECTION"
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
        error?.message ||
          "Something went wrong.",
        true
      );

      setControlsDisabled(false);
    }
  }
);

historyButton.addEventListener(
  "click",
  async () => {
    setControlsDisabled(true);
    setStatus(
      "Opening translation history..."
    );

    try {
      const response =
        await chrome.runtime.sendMessage({
          type:
            "SHOW_TRANSLATION_HISTORY"
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

      setControlsDisabled(false);
    }
  }
);

resetHistoryButton.addEventListener(
  "click",
  async () => {
    const confirmed = window.confirm(
      "Reset translation history?\n\n" +
      "This will permanently clear the five saved translations " +
      "and reset the history panel's size and location."
    );

    if (!confirmed) {
      return;
    }

    setControlsDisabled(true);
    setStatus(
      "Resetting translation history..."
    );

    try {
      const response =
        await chrome.runtime.sendMessage({
          type:
            "RESET_TRANSLATION_HISTORY"
        });

      if (!response?.ok) {
        throw new Error(
          response?.error ||
          "Could not reset translation history."
        );
      }

      setStatus(
        "Translation history and panel layout were reset."
      );
    } catch (error) {
      setStatus(
        error?.message ||
        "Could not reset translation history.",
        true
      );
    } finally {
      setControlsDisabled(false);
    }
  }
);

async function saveEnhancementSettings() {
  try {
    await chrome.storage.local.set({
      aiProofreader:
        aiProofreaderInput.checked,
      smoothDialogue:
        smoothDialogueInput.checked
    });
  } catch (error) {
    console.error(
      "Could not save translation options:",
      error
    );

    setStatus(
      "Could not save translation options.",
      true
    );
  }
}

function showCostWarning(message) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  costToast.textContent = message;

  /*
   * Removing and re-adding the class restarts the five-second animation
   * if the user selects another option while the first warning is visible.
   */
  costToast.classList.remove("show");

  void costToast.offsetWidth;

  costToast.classList.add("show");

  toastTimer = setTimeout(() => {
    costToast.classList.remove("show");
    costToast.textContent = "";
    toastTimer = null;
  }, 5000);
}

function setControlsDisabled(disabled) {
  apiKeyInput.disabled = disabled;
  modelInput.disabled = disabled;
  translateButton.disabled = disabled;
  historyButton.disabled = disabled;
  toggleKeyButton.disabled = disabled;
  aiProofreaderInput.disabled = disabled;
  smoothDialogueInput.disabled = disabled;
  resetHistoryButton.disabled = disabled;
}

function setStatus(
  message,
  isError = false
) {
  statusElement.textContent = message;

  statusElement.classList.toggle(
    "error",
    isError
  );
}
