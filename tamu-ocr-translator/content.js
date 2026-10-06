(() => {
  if (window.__tamuOcrTranslatorLoaded) {
    return;
  }

  window.__tamuOcrTranslatorLoaded = true;

  const IDS = {
    selectionOverlay: "__tamu_ocr_selection_overlay",
    selectionBox: "__tamu_ocr_selection_box",
    resultPanel: "__tamu_ocr_result_panel",
    imageModal: "__tamu_ocr_image_modal"
  };

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message.type === "OCR_START_SELECTION") {
        startSelection();
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "OCR_CROP_SCREENSHOT") {
        cropScreenshot(
          message.screenshotDataUrl,
          message.selection
        )
          .then(async (imageDataUrl) => {
            let historyImageDataUrl = "";

            try {
              historyImageDataUrl =
                await createHistoryPreview(imageDataUrl);
            } catch (error) {
              console.warn(
                "Could not create history preview:",
                error
              );
            }

            sendResponse({
              ok: true,
              imageDataUrl,
              historyImageDataUrl
            });
          })
          .catch((error) => {
            sendResponse({
              ok: false,
              error:
                error.message ||
                "Could not crop the screenshot."
            });
          });

        return true;
      }

      if (message.type === "OCR_SHOW_STATUS") {
        showResultPanel({
          status: message.message || "Working..."
        });

        sendResponse({ ok: true });
        return;
      }

      if (message.type === "OCR_SHOW_RESULT") {
        showResultPanel({
          text: message.text,
          error: message.error,
          history: message.history
        });

        sendResponse({ ok: true });
      }
    }
  );

  function startSelection() {
    removeElement(IDS.selectionOverlay);
    removeElement(IDS.resultPanel);
    removeImageModal();

    const overlay = document.createElement("div");
    overlay.id = IDS.selectionOverlay;

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "crosshair",
      background: "rgba(0, 0, 0, 0.12)",
      userSelect: "none",
      touchAction: "none"
    });

    const instructions =
      document.createElement("div");

    instructions.textContent =
      "Drag around Japanese or Korean text • Press Esc to cancel";

    Object.assign(instructions.style, {
      position: "fixed",
      top: "16px",
      left: "50%",
      transform: "translateX(-50%)",
      maxWidth: "calc(100vw - 32px)",
      padding: "10px 14px",
      borderRadius: "8px",
      background: "#111827",
      color: "#ffffff",
      boxShadow: "0 8px 30px rgba(0, 0, 0, 0.3)",
      font: "600 13px system-ui, sans-serif",
      textAlign: "center",
      pointerEvents: "none"
    });

    const selectionBox =
      document.createElement("div");

    selectionBox.id = IDS.selectionBox;

    Object.assign(selectionBox.style, {
      display: "none",
      position: "fixed",
      border: "2px solid #3b82f6",
      background: "rgba(59, 130, 246, 0.16)",
      boxSizing: "border-box",
      pointerEvents: "none"
    });

    overlay.append(
      instructions,
      selectionBox
    );

    document.documentElement.appendChild(
      overlay
    );

    let dragging = false;
    let startX = 0;
    let startY = 0;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        cleanup();
      }
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();

      dragging = true;
      startX = event.clientX;
      startY = event.clientY;

      selectionBox.style.display = "block";

      updateSelectionBox(
        selectionBox,
        startX,
        startY,
        event.clientX,
        event.clientY
      );

      try {
        overlay.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional.
      }
    };

    const onPointerMove = (event) => {
      if (!dragging) {
        return;
      }

      event.preventDefault();

      updateSelectionBox(
        selectionBox,
        startX,
        startY,
        event.clientX,
        event.clientY
      );
    };

    const onPointerUp = (event) => {
      if (!dragging) {
        return;
      }

      event.preventDefault();
      dragging = false;

      const left = Math.max(
        0,
        Math.min(startX, event.clientX)
      );

      const top = Math.max(
        0,
        Math.min(startY, event.clientY)
      );

      const right = Math.min(
        window.innerWidth,
        Math.max(startX, event.clientX)
      );

      const bottom = Math.min(
        window.innerHeight,
        Math.max(startY, event.clientY)
      );

      const width = right - left;
      const height = bottom - top;

      cleanup();

      if (width < 8 || height < 8) {
        showResultPanel({
          error:
            "The selected area was too small. Please try again."
        });

        return;
      }

      chrome.runtime.sendMessage({
        type: "OCR_REGION_SELECTED",
        selection: {
          left,
          top,
          width,
          height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight
        }
      });
    };

    const onPointerCancel = () => {
      if (dragging) {
        dragging = false;
        cleanup();
      }
    };

    function cleanup() {
      document.removeEventListener(
        "keydown",
        onKeyDown,
        true
      );

      overlay.removeEventListener(
        "pointerdown",
        onPointerDown
      );

      overlay.removeEventListener(
        "pointermove",
        onPointerMove
      );

      overlay.removeEventListener(
        "pointerup",
        onPointerUp
      );

      overlay.removeEventListener(
        "pointercancel",
        onPointerCancel
      );

      overlay.remove();
    }

    document.addEventListener(
      "keydown",
      onKeyDown,
      true
    );

    overlay.addEventListener(
      "pointerdown",
      onPointerDown
    );

    overlay.addEventListener(
      "pointermove",
      onPointerMove
    );

    overlay.addEventListener(
      "pointerup",
      onPointerUp
    );

    overlay.addEventListener(
      "pointercancel",
      onPointerCancel
    );
  }

  function updateSelectionBox(
    element,
    x1,
    y1,
    x2,
    y2
  ) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  }

  async function cropScreenshot(
    screenshotDataUrl,
    selection
  ) {
    if (!screenshotDataUrl) {
      throw new Error(
        "The captured screenshot was empty."
      );
    }

    if (
      !selection ||
      !selection.viewportWidth ||
      !selection.viewportHeight
    ) {
      throw new Error(
        "The selection information was invalid."
      );
    }

    const image = await loadImage(
      screenshotDataUrl
    );

    /*
     * Screenshot pixels may differ from CSS pixels on Retina displays.
     */
    const scaleX =
      image.naturalWidth /
      selection.viewportWidth;

    const scaleY =
      image.naturalHeight /
      selection.viewportHeight;

    const sourceX = Math.max(
      0,
      Math.round(selection.left * scaleX)
    );

    const sourceY = Math.max(
      0,
      Math.round(selection.top * scaleY)
    );

    const sourceWidth = Math.min(
      image.naturalWidth - sourceX,
      Math.max(
        1,
        Math.round(selection.width * scaleX)
      )
    );

    const sourceHeight = Math.min(
      image.naturalHeight - sourceY,
      Math.max(
        1,
        Math.round(selection.height * scaleY)
      )
    );

    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error(
        "The selected image area was invalid."
      );
    }

    const canvas =
      document.createElement("canvas");

    canvas.width = sourceWidth;
    canvas.height = sourceHeight;

    const context =
      canvas.getContext("2d");

    if (!context) {
      throw new Error(
        "The browser could not create an image canvas."
      );
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      sourceWidth,
      sourceHeight
    );

    return canvas.toDataURL("image/png");
  }

  async function createHistoryPreview(
    imageDataUrl
  ) {
    const image = await loadImage(
      imageDataUrl
    );

    /*
     * Reduce image size so five history images fit in session storage.
     */
    const maximumWidth = 900;
    const maximumHeight = 900;

    const scale = Math.min(
      1,
      maximumWidth / image.naturalWidth,
      maximumHeight / image.naturalHeight
    );

    const width = Math.max(
      1,
      Math.round(image.naturalWidth * scale)
    );

    const height = Math.max(
      1,
      Math.round(image.naturalHeight * scale)
    );

    const canvas =
      document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const context =
      canvas.getContext("2d");

    if (!context) {
      return "";
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    context.drawImage(
      image,
      0,
      0,
      width,
      height
    );

    return canvas.toDataURL(
      "image/jpeg",
      0.7
    );
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        resolve(image);
      };

      image.onerror = () => {
        reject(
          new Error(
            "Could not load the captured screenshot."
          )
        );
      };

      image.src = source;
    });
  }

  function showResultPanel({
    status,
    text,
    error,
    history = []
  }) {
    removeElement(IDS.resultPanel);
    removeImageModal();

    const panel =
      document.createElement("section");

    panel.id = IDS.resultPanel;

    Object.assign(panel.style, {
      position: "fixed",
      top: "18px",
      right: "18px",
      zIndex: "2147483646",
      width: "min(480px, calc(100vw - 36px))",
      maxHeight: "calc(100vh - 36px)",
      overflow: "auto",
      boxSizing: "border-box",
      padding: "16px",
      border:
        "1px solid rgba(255, 255, 255, 0.14)",
      borderRadius: "12px",
      background: "#111827",
      color: "#f9fafb",
      boxShadow:
        "0 18px 60px rgba(0, 0, 0, 0.45)",
      font: "14px/1.55 system-ui, sans-serif"
    });

    const header =
      document.createElement("div");

    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      marginBottom: "12px"
    });

    const title =
      document.createElement("strong");

    if (error) {
      title.textContent =
        "Translation error";
    } else if (status) {
      title.textContent =
        "TAMU OCR Translator";
    } else {
      title.textContent =
        "Translation history";
    }

    Object.assign(title.style, {
      color: "#f9fafb",
      font: "700 16px system-ui, sans-serif"
    });

    const closeButton =
      document.createElement("button");

    closeButton.type = "button";
    closeButton.textContent = "×";

    closeButton.setAttribute(
      "aria-label",
      "Close translator"
    );

    Object.assign(closeButton.style, {
      width: "30px",
      height: "30px",
      flex: "0 0 auto",
      padding: "0",
      border: "0",
      borderRadius: "6px",
      cursor: "pointer",
      background: "#374151",
      color: "#ffffff",
      font: "22px/30px system-ui, sans-serif"
    });

    closeButton.addEventListener(
      "mouseenter",
      () => {
        closeButton.style.background =
          "#4b5563";
      }
    );

    closeButton.addEventListener(
      "mouseleave",
      () => {
        closeButton.style.background =
          "#374151";
      }
    );

    closeButton.addEventListener(
      "click",
      () => {
        removeImageModal();
        panel.remove();
      }
    );

    header.append(
      title,
      closeButton
    );

    panel.appendChild(header);

    if (error || status) {
      const message =
        document.createElement("div");

      message.textContent =
        error || status;

      Object.assign(message.style, {
        padding: "4px 0",
        color: error
          ? "#fca5a5"
          : "#93c5fd",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere"
      });

      panel.appendChild(message);

      if (error) {
        const tryAgainButton =
          document.createElement("button");

        tryAgainButton.type = "button";
        tryAgainButton.textContent =
          "Try again";

        Object.assign(
          tryAgainButton.style,
          {
            width: "100%",
            marginTop: "14px",
            padding: "9px 12px",
            border: "0",
            borderRadius: "7px",
            cursor: "pointer",
            background: "#2563eb",
            color: "#ffffff",
            font:
              "600 12px system-ui, sans-serif"
          }
        );

        tryAgainButton.addEventListener(
          "click",
          () => {
            panel.remove();
            startSelection();
          }
        );

        panel.appendChild(
          tryAgainButton
        );
      }
    } else {
      const orderedHistory =
        getOrderedHistory(history, text);

      if (orderedHistory.length === 0) {
        const emptyMessage =
          document.createElement("div");

        emptyMessage.textContent =
          "No translation was returned.";

        Object.assign(
          emptyMessage.style,
          {
            color: "#94a3b8",
            font:
              "12px/1.45 system-ui, sans-serif"
          }
        );

        panel.appendChild(
          emptyMessage
        );
      } else {
        const historyContainer =
          document.createElement("div");

        Object.assign(
          historyContainer.style,
          {
            display: "flex",
            flexDirection: "column",
            gap: "12px"
          }
        );

        orderedHistory.forEach(
          (entry, index) => {
            const wrapper =
              document.createElement("div");

            const isNewest =
              index ===
              orderedHistory.length - 1;

            const label =
              document.createElement("div");

            if (isNewest) {
              label.textContent =
                "Newest translation";
            } else if (index === 0) {
              label.textContent =
                "Oldest translation";
            } else {
              label.textContent =
                "Previous translation";
            }

            Object.assign(
              label.style,
              {
                margin: "0 0 5px",
                color: isNewest
                  ? "#93c5fd"
                  : "#94a3b8",
                font:
                  "700 10px system-ui, sans-serif",
                textTransform: "uppercase",
                letterSpacing: "0.04em"
              }
            );

            const historyItem =
              createHistoryItem(
                entry,
                index
              );

            if (isNewest) {
              Object.assign(
                historyItem.style,
                {
                  border:
                    "1px solid rgba(96, 165, 250, 0.7)",
                  boxShadow:
                    "0 0 0 1px rgba(96, 165, 250, 0.12)"
                }
              );
            }

            wrapper.append(
              label,
              historyItem
            );

            historyContainer.appendChild(
              wrapper
            );
          }
        );

        panel.appendChild(
          historyContainer
        );
      }

      const actions =
        document.createElement("div");

      Object.assign(actions.style, {
        position: "sticky",
        bottom: "0",
        display: "flex",
        gap: "8px",
        marginTop: "14px",
        paddingTop: "12px",
        background: "#111827"
      });

      const newTranslationButton =
        document.createElement("button");

      newTranslationButton.type = "button";
      newTranslationButton.textContent =
        "New translation";

      Object.assign(
        newTranslationButton.style,
        {
          flex: "1",
          minWidth: "0",
          padding: "9px 12px",
          border: "0",
          borderRadius: "7px",
          cursor: "pointer",
          background: "#374151",
          color: "#ffffff",
          font:
            "600 12px system-ui, sans-serif"
        }
      );

      newTranslationButton.addEventListener(
        "mouseenter",
        () => {
          newTranslationButton.style.background =
            "#4b5563";
        }
      );

      newTranslationButton.addEventListener(
        "mouseleave",
        () => {
          newTranslationButton.style.background =
            "#374151";
        }
      );

      newTranslationButton.addEventListener(
        "click",
        () => {
          removeImageModal();
          panel.remove();
          startSelection();
        }
      );

      const copyButton =
        document.createElement("button");

      copyButton.type = "button";
      copyButton.textContent =
        "Copy translation";

      Object.assign(copyButton.style, {
        flex: "1",
        minWidth: "0",
        padding: "9px 12px",
        border: "0",
        borderRadius: "7px",
        cursor: "pointer",
        background: "#2563eb",
        color: "#ffffff",
        font:
          "600 12px system-ui, sans-serif"
      });

      copyButton.addEventListener(
        "mouseenter",
        () => {
          copyButton.style.background =
            "#1d4ed8";
        }
      );

      copyButton.addEventListener(
        "mouseleave",
        () => {
          copyButton.style.background =
            "#2563eb";
        }
      );

      copyButton.addEventListener(
        "click",
        async () => {
          const newestEntry =
            orderedHistory[
              orderedHistory.length - 1
            ];

          const newestTranslation =
            newestEntry?.text ||
            text ||
            "";

          await copyTextWithFeedback(
            newestTranslation,
            copyButton,
            "Copy translation"
          );
        }
      );

      actions.append(
        newTranslationButton,
        copyButton
      );

      panel.appendChild(actions);
    }

    document.documentElement.appendChild(
      panel
    );

    if (!error && !status) {
      requestAnimationFrame(() => {
        panel.scrollTop =
          panel.scrollHeight;
      });
    }
  }

  function getOrderedHistory(
    history,
    currentText
  ) {
    const orderedHistory =
      Array.isArray(history)
        ? history
            .filter((entry) => {
              return (
                entry &&
                typeof entry.text === "string"
              );
            })
            .map((entry) => ({
              ...entry
            }))
        : [];

    orderedHistory.sort(
      (first, second) => {
        return (
          getEntryTimestamp(first) -
          getEntryTimestamp(second)
        );
      }
    );

    if (
      orderedHistory.length === 0 &&
      typeof currentText === "string" &&
      currentText.trim()
    ) {
      orderedHistory.push({
        id: `temporary-${Date.now()}`,
        text: currentText.trim(),
        imageDataUrl: "",
        createdAt:
          new Date().toISOString()
      });
    }

    return orderedHistory.slice(-5);
  }

  function getEntryTimestamp(entry) {
    const timestamp =
      new Date(
        entry?.createdAt || 0
      ).getTime();

    return Number.isFinite(timestamp)
      ? timestamp
      : 0;
  }

  function createHistoryItem(
    entry,
    index
  ) {
    const item =
      document.createElement("article");

    Object.assign(item.style, {
      padding: "10px",
      border:
        "1px solid rgba(255, 255, 255, 0.1)",
      borderRadius: "8px",
      background: "#1f2937"
    });

    if (
      typeof entry?.imageDataUrl ===
        "string" &&
      entry.imageDataUrl
    ) {
      const previewButton =
        document.createElement("button");

      previewButton.type = "button";
      previewButton.title =
        "Click to enlarge screenshot";

      previewButton.setAttribute(
        "aria-label",
        "Enlarge screenshot"
      );

      Object.assign(previewButton.style, {
  display: "block",
  width: "180px",
  maxWidth: "100%",
  margin: "0 auto 9px",
  padding: "0",
  border:
    "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: "7px",
  overflow: "hidden",
  cursor: "zoom-in",
  background: "#0f172a"
});

      const previewImage =
        document.createElement("img");

      previewImage.src =
        entry.imageDataUrl;

      previewImage.alt =
        "Screenshot used for this translation";

Object.assign(previewImage.style, {
  display: "block",
  width: "100%",
  height: "100px",
  objectFit: "contain",
  background: "#0f172a"
});

      previewButton.appendChild(
        previewImage
      );

      previewButton.addEventListener(
        "click",
        () => {
          showEnlargedImage(
            entry.imageDataUrl,
            entry.text
          );
        }
      );

      item.appendChild(
        previewButton
      );
    }

    const itemHeader =
      document.createElement("div");

    Object.assign(
      itemHeader.style,
      {
        display: "flex",
        alignItems: "center",
        justifyContent:
          "space-between",
        gap: "8px",
        marginBottom: "6px"
      }
    );

    const time =
      document.createElement("span");

    time.textContent =
      formatHistoryTime(
        entry?.createdAt
      );

    Object.assign(time.style, {
      color: "#94a3b8",
      font:
        "10px system-ui, sans-serif"
    });

    const copyHistoryButton =
      document.createElement("button");

    copyHistoryButton.type = "button";
    copyHistoryButton.textContent =
      "Copy";

    Object.assign(
      copyHistoryButton.style,
      {
        padding: "4px 8px",
        border: "0",
        borderRadius: "5px",
        cursor: "pointer",
        background: "#374151",
        color: "#ffffff",
        font:
          "600 10px system-ui, sans-serif"
      }
    );

    copyHistoryButton.addEventListener(
      "click",
      async () => {
        await copyTextWithFeedback(
          entry?.text || "",
          copyHistoryButton,
          "Copy"
        );
      }
    );

    itemHeader.append(
      time,
      copyHistoryButton
    );

    const itemText =
      document.createElement("div");

    itemText.textContent =
      entry?.text ||
      "No translation text.";

Object.assign(itemText.style, {
  maxHeight: "200px",
  overflow: "auto",
  color: "#f3f4f6",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  font:
    "15px/1.55 system-ui, sans-serif"
});

    item.append(
      itemHeader,
      itemText
    );

    return item;
  }

  async function copyTextWithFeedback(
    value,
    button,
    originalLabel
  ) {
    try {
      await navigator.clipboard.writeText(
        value
      );

      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }

    setTimeout(() => {
      if (button.isConnected) {
        button.textContent =
          originalLabel;
      }
    }, 1500);
  }

  function showEnlargedImage(
    imageDataUrl,
    translationText = ""
  ) {
    removeImageModal();

    const modal =
      document.createElement("div");

    modal.id = IDS.imageModal;

    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      boxSizing: "border-box",
      background: "rgba(0, 0, 0, 0.88)",
      cursor: "zoom-out"
    });

    const modalContent =
      document.createElement("div");

    Object.assign(
      modalContent.style,
      {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "12px",
        maxWidth: "95vw",
        maxHeight: "95vh",
        cursor: "default"
      }
    );

    const enlargedImage =
      document.createElement("img");

    enlargedImage.src =
      imageDataUrl;

    enlargedImage.alt =
      "Enlarged screenshot used for translation";

    Object.assign(
      enlargedImage.style,
      {
        display: "block",
        maxWidth: "95vw",
        maxHeight: "78vh",
        objectFit: "contain",
        borderRadius: "8px",
        background: "#ffffff",
        boxShadow:
          "0 20px 70px rgba(0, 0, 0, 0.6)"
      }
    );

    const closeButton =
      document.createElement("button");

    closeButton.type = "button";
    closeButton.textContent = "×";

    closeButton.setAttribute(
      "aria-label",
      "Close enlarged screenshot"
    );

    Object.assign(
      closeButton.style,
      {
        position: "absolute",
        top: "-16px",
        right: "-16px",
        width: "38px",
        height: "38px",
        padding: "0",
        border:
          "1px solid rgba(255, 255, 255, 0.2)",
        borderRadius: "50%",
        cursor: "pointer",
        background: "#111827",
        color: "#ffffff",
        boxShadow:
          "0 8px 24px rgba(0, 0, 0, 0.45)",
        font:
          "26px/36px system-ui, sans-serif"
      }
    );

    modalContent.append(
      enlargedImage,
      closeButton
    );

    if (translationText) {
      const caption =
        document.createElement("div");

      caption.textContent =
        translationText;

      Object.assign(
        caption.style,
        {
          width:
            "min(800px, 90vw)",
          maxHeight: "120px",
          overflow: "auto",
          boxSizing: "border-box",
          padding: "10px 12px",
          borderRadius: "8px",
          background: "#111827",
          color: "#f3f4f6",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          font:
            "16px/1.55 system-ui, sans-serif"
        }
      );

      modalContent.appendChild(
        caption
      );
    }

    modal.appendChild(
      modalContent
    );

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        removeImageModal();
      }
    };

    modal.__tamuKeydownHandler =
      onKeyDown;

    closeButton.addEventListener(
      "click",
      () => {
        removeImageModal();
      }
    );

    modal.addEventListener(
      "click",
      (event) => {
        if (event.target === modal) {
          removeImageModal();
        }
      }
    );

    document.addEventListener(
      "keydown",
      onKeyDown,
      true
    );

    document.documentElement.appendChild(
      modal
    );
  }

  function removeImageModal() {
    const modal =
      document.getElementById(
        IDS.imageModal
      );

    if (!modal) {
      return;
    }

    if (
      typeof modal.__tamuKeydownHandler ===
      "function"
    ) {
      document.removeEventListener(
        "keydown",
        modal.__tamuKeydownHandler,
        true
      );
    }

    modal.remove();
  }

  function formatHistoryTime(value) {
    if (!value) {
      return "Previous translation";
    }

    const date = new Date(value);

    if (
      Number.isNaN(date.getTime())
    ) {
      return "Previous translation";
    }

    return date.toLocaleTimeString(
      undefined,
      {
        hour: "numeric",
        minute: "2-digit"
      }
    );
  }

  function removeElement(id) {
    document.getElementById(id)?.remove();
  }
})();
