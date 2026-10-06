(() => {
  const IDS = {
    selectionOverlay:
      "__tamu_ocr_selection_overlay",

    selectionBox:
      "__tamu_ocr_selection_box",

    resultPanel:
      "__tamu_ocr_result_panel",

    imageModal:
      "__tamu_ocr_image_modal",

    translationProgress:
      "__tamu_ocr_translation_progress"
  };

  const PANEL_GEOMETRY_KEY =
    "translationPanelGeometry";

  let cachedPanelGeometry = null;

  /*
   * Load saved size and location in advance.
   */
  chrome.storage.local
    .get([
      PANEL_GEOMETRY_KEY
    ])
    .then((stored) => {
      const geometry =
        stored[PANEL_GEOMETRY_KEY];

      if (
        isValidPanelGeometry(
          geometry
        )
      ) {
        cachedPanelGeometry =
          geometry;
      }
    })
    .catch((error) => {
      console.warn(
        "Could not preload panel geometry:",
        error
      );
    });

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (
        !message ||
        typeof message.type !== "string"
      ) {
        return false;
      }

      if (message.type === "OCR_PING") {
        sendResponse({
          ok: true
        });

        return;
      }

      if (
        message.type ===
        "OCR_START_SELECTION"
      ) {
        startSelection();

        sendResponse({
          ok: true
        });

        return;
      }

      if (
        message.type ===
        "OCR_RESET_HISTORY_UI"
      ) {
        cachedPanelGeometry = null;

        removeElement(
          IDS.resultPanel
        );

        removeImageModal();

        sendResponse({
          ok: true
        });

        return;
      }

      if (
        message.type ===
        "OCR_CROP_SCREENSHOT"
      ) {
        cropScreenshot(
          message.screenshotDataUrl,
          message.selection
        )
          .then(async (imageDataUrl) => {
            let historyImageDataUrl =
              "";

            try {
              historyImageDataUrl =
                await createHistoryPreview(
                  imageDataUrl
                );
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
                error?.message ||
                "Could not crop the screenshot."
            });
          });

        return true;
      }

      /*
       * Progress is shown as a temporary card below existing history.
       */
      if (
        message.type ===
        "OCR_SHOW_STATUS"
      ) {
        showTranslationProgress({
          message:
            message.message ||
            "Translating...",

          history:
            Array.isArray(
              message.history
            )
              ? message.history
              : []
        });

        sendResponse({
          ok: true
        });

        return;
      }

      /*
       * A successful result rebuilds history and replaces the temporary
       * progress card with the newest translation.
       */
      if (
        message.type ===
        "OCR_SHOW_RESULT"
      ) {
        if (message.error) {
          showTranslationProgress({
            message: message.error,
            history:
              Array.isArray(
                message.history
              )
                ? message.history
                : [],
            isError: true
          });
        } else {
          showResultPanel({
            text: message.text,
            history:
              Array.isArray(
                message.history
              )
                ? message.history
                : [],
            scrollToNewest: true
          });
        }

        sendResponse({
          ok: true
        });

        return;
      }

      if (
        message.type ===
        "OCR_SHOW_HISTORY"
      ) {
        showResultPanel({
          history:
            Array.isArray(
              message.history
            )
              ? message.history
              : [],
          scrollToNewest: true
        });

        sendResponse({
          ok: true
        });

        return;
      }

      return false;
    }
  );

  function startSelection() {
    removeElement(
      IDS.selectionOverlay
    );

    removeElement(
      IDS.resultPanel
    );

    removeImageModal();

    const overlay =
      document.createElement("div");

    overlay.id =
      IDS.selectionOverlay;

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      cursor: "crosshair",
      background:
        "rgba(0, 0, 0, 0.12)",
      userSelect: "none",
      touchAction: "none"
    });

    const instructions =
      document.createElement("div");

    instructions.textContent =
      "Drag around foreign text • Press Esc to cancel";

    Object.assign(
      instructions.style,
      {
        position: "fixed",
        top: "16px",
        left: "50%",
        transform:
          "translateX(-50%)",
        maxWidth:
          "calc(100vw - 32px)",
        padding: "10px 14px",
        borderRadius: "8px",
        background: "#111827",
        color: "#ffffff",
        boxShadow:
          "0 8px 30px rgba(0, 0, 0, 0.3)",
        font:
          "600 13px system-ui, sans-serif",
        textAlign: "center",
        pointerEvents: "none"
      }
    );

    const selectionBox =
      document.createElement("div");

    selectionBox.id =
      IDS.selectionBox;

    Object.assign(
      selectionBox.style,
      {
        display: "none",
        position: "fixed",
        border:
          "2px solid #3b82f6",
        background:
          "rgba(59, 130, 246, 0.16)",
        boxSizing: "border-box",
        pointerEvents: "none"
      }
    );

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

      selectionBox.style.display =
        "block";

      updateSelectionBox(
        selectionBox,
        startX,
        startY,
        event.clientX,
        event.clientY
      );

      try {
        overlay.setPointerCapture(
          event.pointerId
        );
      } catch {
        /*
         * Pointer capture is optional.
         */
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
        Math.min(
          startX,
          event.clientX
        )
      );

      const top = Math.max(
        0,
        Math.min(
          startY,
          event.clientY
        )
      );

      const right = Math.min(
        window.innerWidth,
        Math.max(
          startX,
          event.clientX
        )
      );

      const bottom = Math.min(
        window.innerHeight,
        Math.max(
          startY,
          event.clientY
        )
      );

      const width =
        right - left;

      const height =
        bottom - top;

      cleanup();

      if (
        width < 8 ||
        height < 8
      ) {
        showTranslationProgress({
          message:
            "The selected area was too small. Please try again.",
          history: [],
          isError: true
        });

        return;
      }

      chrome.runtime.sendMessage({
        type:
          "OCR_REGION_SELECTED",
        selection: {
          left,
          top,
          width,
          height,
          viewportWidth:
            window.innerWidth,
          viewportHeight:
            window.innerHeight
        }
      });
    };

    const onPointerCancel = () => {
      dragging = false;
      cleanup();
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
    const left =
      Math.min(x1, x2);

    const top =
      Math.min(y1, y2);

    const width =
      Math.abs(x2 - x1);

    const height =
      Math.abs(y2 - y1);

    element.style.left =
      `${left}px`;

    element.style.top =
      `${top}px`;

    element.style.width =
      `${width}px`;

    element.style.height =
      `${height}px`;
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

    const image =
      await loadImage(
        screenshotDataUrl
      );

    /*
     * Retina displays can use more screenshot pixels than CSS pixels.
     */
    const scaleX =
      image.naturalWidth /
      selection.viewportWidth;

    const scaleY =
      image.naturalHeight /
      selection.viewportHeight;

    const sourceX =
      Math.max(
        0,
        Math.round(
          selection.left *
          scaleX
        )
      );

    const sourceY =
      Math.max(
        0,
        Math.round(
          selection.top *
          scaleY
        )
      );

    const sourceWidth =
      Math.min(
        image.naturalWidth -
          sourceX,
        Math.max(
          1,
          Math.round(
            selection.width *
            scaleX
          )
        )
      );

    const sourceHeight =
      Math.min(
        image.naturalHeight -
          sourceY,
        Math.max(
          1,
          Math.round(
            selection.height *
            scaleY
          )
        )
      );

    if (
      sourceWidth <= 0 ||
      sourceHeight <= 0
    ) {
      throw new Error(
        "The selected image area was invalid."
      );
    }

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width =
      sourceWidth;

    canvas.height =
      sourceHeight;

    const context =
      canvas.getContext("2d");

    if (!context) {
      throw new Error(
        "The browser could not create an image canvas."
      );
    }

    context.imageSmoothingEnabled =
      true;

    context.imageSmoothingQuality =
      "high";

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

    return canvas.toDataURL(
      "image/png"
    );
  }

  async function createHistoryPreview(
    imageDataUrl
  ) {
    const image =
      await loadImage(
        imageDataUrl
      );

    const maximumWidth = 900;
    const maximumHeight = 900;

    const scale = Math.min(
      1,
      maximumWidth /
        image.naturalWidth,
      maximumHeight /
        image.naturalHeight
    );

    const width = Math.max(
      1,
      Math.round(
        image.naturalWidth *
        scale
      )
    );

    const height = Math.max(
      1,
      Math.round(
        image.naturalHeight *
        scale
      )
    );

    const canvas =
      document.createElement(
        "canvas"
      );

    canvas.width = width;
    canvas.height = height;

    const context =
      canvas.getContext("2d");

    if (!context) {
      return "";
    }

    context.imageSmoothingEnabled =
      true;

    context.imageSmoothingQuality =
      "high";

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
    return new Promise(
      (resolve, reject) => {
        const image =
          new Image();

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
      }
    );
  }

  function showResultPanel({
    text,
    history = [],
    scrollToNewest = true
  } = {}) {
    removeElement(
      IDS.resultPanel
    );

    removeImageModal();

    const panel =
      document.createElement(
        "section"
      );

    panel.id =
      IDS.resultPanel;

    panel.__tamuGeometryReady =
      false;

    Object.assign(panel.style, {
      position: "fixed",
      top: "18px",
      right: "18px",
      width:
        "min(520px, calc(100vw - 36px))",
      height:
        "min(680px, calc(100vh - 36px))",
      minWidth: "320px",
      minHeight: "220px",
      maxWidth:
        "calc(100vw - 12px)",
      maxHeight:
        "calc(100vh - 12px)",
      zIndex: "2147483646",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      resize: "both",
      boxSizing: "border-box",
      border:
        "1px solid rgba(255, 255, 255, 0.16)",
      borderRadius: "12px",
      background: "#111827",
      color: "#f9fafb",
      boxShadow:
        "0 18px 60px rgba(0, 0, 0, 0.45)",
      fontFamily:
        "system-ui, sans-serif",
      fontSize: "14px"
    });

    const header =
      document.createElement(
        "header"
      );

    Object.assign(header.style, {
      position: "relative",
      zIndex: "20",
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      justifyContent:
        "space-between",
      gap: "12px",
      minHeight: "54px",
      boxSizing: "border-box",
      padding: "12px 14px",
      borderBottom:
        "1px solid rgba(255, 255, 255, 0.12)",
      background: "#111827",
      cursor: "move",
      userSelect: "none"
    });

    const title =
      document.createElement(
        "strong"
      );

    title.textContent =
      "Translation history";

    Object.assign(title.style, {
      paddingRight: "42px",
      color: "#f9fafb",
      fontSize: "1.15em",
      lineHeight: "1.25"
    });

    const closeButton =
      document.createElement(
        "button"
      );

    closeButton.type =
      "button";

    closeButton.textContent =
      "×";

    closeButton.setAttribute(
      "aria-label",
      "Close translation history"
    );

    /*
     * This stays pinned because only scrollingBody scrolls.
     */
    Object.assign(
      closeButton.style,
      {
        position: "absolute",
        top: "10px",
        right: "10px",
        zIndex: "30",
        width: "34px",
        height: "34px",
        padding: "0",
        border: "0",
        borderRadius: "7px",
        cursor: "pointer",
        background: "#374151",
        color: "#ffffff",
        font:
          "24px/34px system-ui, sans-serif"
      }
    );

    closeButton.addEventListener(
      "pointerdown",
      (event) => {
        event.stopPropagation();
      }
    );

    closeButton.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();

        savePanelGeometry(panel);

        removeImageModal();

        removeElement(
          IDS.resultPanel
        );
      }
    );

    header.append(
      title,
      closeButton
    );

    const scrollingBody =
      document.createElement(
        "div"
      );

    scrollingBody.dataset.tamuHistoryScroll =
      "true";

    Object.assign(
      scrollingBody.style,
      {
        position: "relative",
        flex: "1 1 auto",
        minHeight: "0",
        overflowX: "hidden",
        overflowY: "auto",
        boxSizing: "border-box",
        padding: "14px"
      }
    );

    panel.append(
      header,
      scrollingBody
    );

    makePanelDraggable(
      panel,
      header,
      closeButton
    );

    makePanelContentResponsive(
      panel
    );

    const orderedHistory =
      getOrderedHistory(
        history,
        text
      );

    if (
      orderedHistory.length === 0
    ) {
      const emptyMessage =
        document.createElement(
          "div"
        );

      emptyMessage.dataset.tamuEmptyHistory =
        "true";

      emptyMessage.textContent =
        "No translation history yet.";

      Object.assign(
        emptyMessage.style,
        {
          padding: "16px 4px",
          color: "#94a3b8",
          textAlign: "center",
          fontSize: "1em",
          lineHeight: "1.5"
        }
      );

      scrollingBody.appendChild(
        emptyMessage
      );
    } else {
      const historyContainer =
        document.createElement(
          "div"
        );

      historyContainer.dataset.tamuHistoryList =
        "true";

      Object.assign(
        historyContainer.style,
        {
          display: "flex",
          flexDirection: "column",
          gap: "1em"
        }
      );

      orderedHistory.forEach(
        (entry, index) => {
          const wrapper =
            document.createElement(
              "div"
            );

          const isNewest =
            index ===
            orderedHistory.length - 1;

          const label =
            document.createElement(
              "div"
            );

          if (isNewest) {
            label.textContent =
              "Newest translation";
          } else if (
            index === 0
          ) {
            label.textContent =
              "Oldest translation";
          } else {
            label.textContent =
              "Previous translation";
          }

          Object.assign(
            label.style,
            {
              margin:
                "0 0 0.4em",
              color: isNewest
                ? "#93c5fd"
                : "#94a3b8",
              fontSize: "0.72em",
              fontWeight: "700",
              lineHeight: "1.2",
              textTransform:
                "uppercase",
              letterSpacing:
                "0.04em"
            }
          );

          const historyItem =
            createHistoryItem(
              entry
            );

          if (isNewest) {
            Object.assign(
              historyItem.style,
              {
                borderColor:
                  "rgba(96, 165, 250, 0.75)",
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

      scrollingBody.appendChild(
        historyContainer
      );
    }

    const actions =
      document.createElement(
        "div"
      );

    actions.dataset.tamuHistoryActions =
      "true";

    Object.assign(
      actions.style,
      {
        position: "sticky",
        bottom: "-14px",
        zIndex: "10",
        display: "flex",
        gap: "0.6em",
        marginTop: "1em",
        padding:
          "0.9em 0 0.2em",
        background: "#111827"
      }
    );

    const newTranslationButton =
      createButton(
        "New translation",
        "#374151"
      );

    const copyButton =
      createButton(
        "Copy translation",
        "#2563eb"
      );

    newTranslationButton.style.flex =
      "1";

    copyButton.style.flex =
      "1";

    newTranslationButton.addEventListener(
      "click",
      () => {
        savePanelGeometry(panel);

        removeImageModal();

        removeElement(
          IDS.resultPanel
        );

        startSelection();
      }
    );

    copyButton.addEventListener(
      "click",
      async () => {
        const newestEntry =
          orderedHistory[
            orderedHistory.length - 1
          ];

        await copyTextWithFeedback(
          newestEntry?.text ||
            text ||
            "",
          copyButton,
          "Copy translation"
        );
      }
    );

    actions.append(
      newTranslationButton,
      copyButton
    );

    scrollingBody.appendChild(
      actions
    );

    document.documentElement.appendChild(
      panel
    );

    restorePanelGeometry(panel)
      .catch((error) => {
        console.warn(
          "Could not restore panel geometry:",
          error
        );
      })
      .finally(() => {
        if (!panel.isConnected) {
          return;
        }

        keepPanelOnScreen(panel);

        panel.__tamuGeometryReady =
          true;

        schedulePanelGeometrySave(
          panel
        );

        if (scrollToNewest) {
          scrollToNewestTranslation(
            scrollingBody
          );
        }
      });
  }

  function showTranslationProgress({
    message = "Translating...",
    history = [],
    isError = false
  } = {}) {
    let panel =
      document.getElementById(
        IDS.resultPanel
      );

    /*
     * If no history panel is open, create it with the previous history.
     */
    if (!panel) {
      showResultPanel({
        history,
        scrollToNewest: false
      });

      panel =
        document.getElementById(
          IDS.resultPanel
        );
    }

    if (!panel) {
      console.error(
        "Could not create translation history panel."
      );

      return;
    }

    const scrollingBody =
      panel.querySelector(
        '[data-tamu-history-scroll="true"]'
      );

    if (!scrollingBody) {
      console.error(
        "Could not find the history scroll area."
      );

      return;
    }

    scrollingBody
      .querySelector(
        '[data-tamu-empty-history="true"]'
      )
      ?.remove();

    const actions =
      scrollingBody.querySelector(
        '[data-tamu-history-actions="true"]'
      );

    let progressWrapper =
      document.getElementById(
        IDS.translationProgress
      );

    /*
     * Update the existing progress card if this is the second status.
     */
    if (progressWrapper) {
      const progressMessage =
        progressWrapper.querySelector(
          '[data-tamu-progress-message="true"]'
        );

      const progressIcon =
        progressWrapper.querySelector(
          '[data-tamu-progress-icon="true"]'
        );

      const progressCard =
        progressWrapper.querySelector(
          '[data-tamu-progress-card="true"]'
        );

      const progressLabel =
        progressWrapper.querySelector(
          '[data-tamu-progress-label="true"]'
        );

      if (progressMessage) {
        progressMessage.textContent =
          message;
      }

      if (isError) {
        if (progressIcon) {
          progressIcon.textContent =
            "⚠️";
        }

        if (progressMessage) {
          progressMessage.style.color =
            "#fca5a5";
        }

        if (progressCard) {
          progressCard.style.borderColor =
            "rgba(248, 113, 113, 0.8)";
        }

        if (progressLabel) {
          progressLabel.textContent =
            "Translation failed";

          progressLabel.style.color =
            "#fca5a5";
        }

        if (actions) {
          actions.style.display =
            "flex";
        }
      }

      scrollToNewestTranslation(
        scrollingBody
      );

      return;
    }

    if (actions) {
      actions.style.display =
        isError
          ? "flex"
          : "none";
    }

    progressWrapper =
      document.createElement("div");

    progressWrapper.id =
      IDS.translationProgress;

    progressWrapper.setAttribute(
      "role",
      "status"
    );

    progressWrapper.setAttribute(
      "aria-live",
      "polite"
    );

    Object.assign(
      progressWrapper.style,
      {
        marginTop: "1em"
      }
    );

    const progressLabel =
      document.createElement("div");

    progressLabel.dataset.tamuProgressLabel =
      "true";

    progressLabel.textContent =
      isError
        ? "Translation failed"
        : "New translation";

    Object.assign(
      progressLabel.style,
      {
        margin: "0 0 0.4em",
        color: isError
          ? "#fca5a5"
          : "#93c5fd",
        fontSize: "0.72em",
        fontWeight: "700",
        lineHeight: "1.2",
        textTransform: "uppercase",
        letterSpacing: "0.04em"
      }
    );

    const progressCard =
      document.createElement(
        "article"
      );

    progressCard.dataset.tamuProgressCard =
      "true";

    Object.assign(
      progressCard.style,
      {
        display: "flex",
        alignItems: "center",
        gap: "0.8em",
        minHeight: "4.5em",
        boxSizing: "border-box",
        padding: "0.9em",
        border:
          isError
            ? "1px solid rgba(248, 113, 113, 0.8)"
            : "1px solid rgba(96, 165, 250, 0.75)",
        borderRadius: "0.6em",
        background: "#1f2937",
        boxShadow:
          "0 0 0 1px rgba(96, 165, 250, 0.12)"
      }
    );

    const progressIcon =
      document.createElement("span");

    progressIcon.dataset.tamuProgressIcon =
      "true";

    progressIcon.textContent =
      isError
        ? "⚠️"
        : "⏳";

    progressIcon.setAttribute(
      "aria-hidden",
      "true"
    );

    Object.assign(
      progressIcon.style,
      {
        flex: "0 0 auto",
        fontSize: "1.35em",
        lineHeight: "1"
      }
    );

    const progressMessage =
      document.createElement("div");

    progressMessage.dataset.tamuProgressMessage =
      "true";

    progressMessage.textContent =
      message;

    Object.assign(
      progressMessage.style,
      {
        flex: "1 1 auto",
        minWidth: "0",
        color: isError
          ? "#fca5a5"
          : "#bfdbfe",
        fontSize: "1em",
        fontWeight: "600",
        lineHeight: "1.5",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere"
      }
    );

    progressCard.append(
      progressIcon,
      progressMessage
    );

    progressWrapper.append(
      progressLabel,
      progressCard
    );

    /*
     * Place progress after history and before the sticky action buttons.
     */
    if (actions) {
      scrollingBody.insertBefore(
        progressWrapper,
        actions
      );
    } else {
      scrollingBody.appendChild(
        progressWrapper
      );
    }

    scrollToNewestTranslation(
      scrollingBody
    );
  }

  function createHistoryItem(entry) {
    const item =
      document.createElement(
        "article"
      );

    Object.assign(item.style, {
      padding: "0.75em",
      border:
        "1px solid rgba(255, 255, 255, 0.1)",
      borderRadius: "0.6em",
      background: "#1f2937"
    });

    const itemHeader =
      document.createElement(
        "div"
      );

    Object.assign(
      itemHeader.style,
      {
        display: "flex",
        alignItems: "center",
        justifyContent:
          "space-between",
        gap: "0.6em",
        marginBottom: "0.55em"
      }
    );

    const time =
      document.createElement(
        "span"
      );

    time.textContent =
      formatHistoryTime(
        entry?.createdAt
      );

    Object.assign(time.style, {
      color: "#94a3b8",
      fontSize: "0.72em"
    });

    const copyHistoryButton =
      createButton(
        "Copy",
        "#374151"
      );

    Object.assign(
      copyHistoryButton.style,
      {
        flex: "0 0 auto",
        padding:
          "0.35em 0.65em",
        fontSize: "0.72em"
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

    const contentRow =
      document.createElement(
        "div"
      );

    Object.assign(
      contentRow.style,
      {
        display: "flex",
        alignItems: "stretch",
        gap: "0.7em",
        width: "100%",
        minHeight: "5em",
        maxHeight: "18em"
      }
    );

    const itemText =
      document.createElement(
        "div"
      );

    itemText.textContent =
      entry?.text ||
      "No translation text.";

    Object.assign(
      itemText.style,
      {
        flex: "1 1 78%",
        minWidth: "0",
        maxHeight: "18em",
        overflow: "auto",
        boxSizing: "border-box",
        padding: "0.55em",
        borderRadius: "0.45em",
        background: "#111827",
        color: "#f3f4f6",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontSize: "1.08em",
        lineHeight: "1.55"
      }
    );

    contentRow.appendChild(
      itemText
    );

    if (
      typeof entry?.imageDataUrl ===
        "string" &&
      entry.imageDataUrl
    ) {
      const previewButton =
        document.createElement(
          "button"
        );

      previewButton.type =
        "button";

      previewButton.title =
        "Click to enlarge screenshot";

      previewButton.setAttribute(
        "aria-label",
        "Enlarge screenshot used for this translation"
      );

      Object.assign(
        previewButton.style,
        {
          position: "relative",
          flex: "0 0 20%",
          minWidth: "5.5em",
          minHeight: "5em",
          alignSelf: "stretch",
          padding: "0",
          border:
            "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "0.5em",
          overflow: "hidden",
          cursor: "zoom-in",
          background: "#0f172a"
        }
      );

      const previewImage =
        document.createElement(
          "img"
        );

      previewImage.src =
        entry.imageDataUrl;

      previewImage.alt =
        "Screenshot used for this translation";

      Object.assign(
        previewImage.style,
        {
          position: "absolute",
          inset: "0",
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#0f172a"
        }
      );

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

      contentRow.appendChild(
        previewButton
      );
    }

    item.append(
      itemHeader,
      contentRow
    );

    return item;
  }

  function makePanelDraggable(
    panel,
    handle,
    ignoredElement
  ) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onPointerDown = (
      event
    ) => {
      if (
        event.button !== 0 ||
        event.target ===
          ignoredElement ||
        ignoredElement.contains(
          event.target
        )
      ) {
        return;
      }

      event.preventDefault();

      const rectangle =
        panel.getBoundingClientRect();

      panel.style.left =
        `${rectangle.left}px`;

      panel.style.top =
        `${rectangle.top}px`;

      panel.style.right =
        "auto";

      dragging = true;

      offsetX =
        event.clientX -
        rectangle.left;

      offsetY =
        event.clientY -
        rectangle.top;

      try {
        handle.setPointerCapture(
          event.pointerId
        );
      } catch {
        /*
         * Pointer capture is optional.
         */
      }
    };

    const onPointerMove = (
      event
    ) => {
      if (!dragging) {
        return;
      }

      const maximumLeft =
        Math.max(
          0,
          window.innerWidth -
          panel.offsetWidth
        );

      const maximumTop =
        Math.max(
          0,
          window.innerHeight -
          panel.offsetHeight
        );

      const left = Math.min(
        maximumLeft,
        Math.max(
          0,
          event.clientX -
          offsetX
        )
      );

      const top = Math.min(
        maximumTop,
        Math.max(
          0,
          event.clientY -
          offsetY
        )
      );

      panel.style.left =
        `${left}px`;

      panel.style.top =
        `${top}px`;

      panel.style.right =
        "auto";
    };

    const stopDragging = () => {
      if (!dragging) {
        return;
      }

      dragging = false;

      savePanelGeometry(
        panel
      );
    };

    handle.addEventListener(
      "pointerdown",
      onPointerDown
    );

    document.addEventListener(
      "pointermove",
      onPointerMove,
      true
    );

    document.addEventListener(
      "pointerup",
      stopDragging,
      true
    );

    document.addEventListener(
      "pointercancel",
      stopDragging,
      true
    );

    panel.__tamuDragCleanup = () => {
      document.removeEventListener(
        "pointermove",
        onPointerMove,
        true
      );

      document.removeEventListener(
        "pointerup",
        stopDragging,
        true
      );

      document.removeEventListener(
        "pointercancel",
        stopDragging,
        true
      );
    };
  }

  function makePanelContentResponsive(
    panel
  ) {
    const updateScale = () => {
      const width =
        panel.getBoundingClientRect()
          .width;

      const scale = Math.min(
        1.3,
        Math.max(
          0.78,
          width / 520
        )
      );

      panel.style.fontSize =
        `${14 * scale}px`;
    };

    updateScale();

    if (
      typeof ResizeObserver ===
      "function"
    ) {
      const observer =
        new ResizeObserver(() => {
          updateScale();

          keepPanelOnScreen(
            panel
          );

          if (
            panel.__tamuGeometryReady
          ) {
            schedulePanelGeometrySave(
              panel
            );
          }
        });

      observer.observe(panel);

      panel.__tamuResizeObserver =
        observer;
    }
  }

  function isValidPanelGeometry(
    geometry
  ) {
    return Boolean(
      geometry &&
      Number.isFinite(
        geometry.left
      ) &&
      Number.isFinite(
        geometry.top
      ) &&
      Number.isFinite(
        geometry.width
      ) &&
      Number.isFinite(
        geometry.height
      ) &&
      geometry.width > 0 &&
      geometry.height > 0
    );
  }

  async function restorePanelGeometry(
    panel
  ) {
    let geometry =
      cachedPanelGeometry;

    try {
      const stored =
        await chrome.storage.local.get([
          PANEL_GEOMETRY_KEY
        ]);

      const storedGeometry =
        stored[PANEL_GEOMETRY_KEY];

      if (
        isValidPanelGeometry(
          storedGeometry
        )
      ) {
        geometry =
          storedGeometry;

        cachedPanelGeometry =
          storedGeometry;
      }
    } catch (error) {
      console.warn(
        "Could not read panel geometry:",
        error
      );
    }

    if (
      !panel.isConnected ||
      !isValidPanelGeometry(
        geometry
      )
    ) {
      return;
    }

    const availableWidth =
      Math.max(
        320,
        window.innerWidth - 12
      );

    const availableHeight =
      Math.max(
        220,
        window.innerHeight - 12
      );

    const width = Math.min(
      geometry.width,
      availableWidth
    );

    const height = Math.min(
      geometry.height,
      availableHeight
    );

    const left = Math.min(
      Math.max(
        0,
        geometry.left
      ),
      Math.max(
        0,
        window.innerWidth - width
      )
    );

    const top = Math.min(
      Math.max(
        0,
        geometry.top
      ),
      Math.max(
        0,
        window.innerHeight - height
      )
    );

    panel.style.width =
      `${width}px`;

    panel.style.height =
      `${height}px`;

    panel.style.left =
      `${left}px`;

    panel.style.top =
      `${top}px`;

    panel.style.right =
      "auto";
  }

  function schedulePanelGeometrySave(
    panel
  ) {
    if (
      !panel ||
      !panel.isConnected ||
      !panel.__tamuGeometryReady
    ) {
      return;
    }

    clearTimeout(
      panel.__tamuGeometrySaveTimer
    );

    panel.__tamuGeometrySaveTimer =
      setTimeout(() => {
        savePanelGeometry(
          panel
        );
      }, 250);
  }

  async function savePanelGeometry(
    panel
  ) {
    if (!panel) {
      return;
    }

    const rectangle =
      panel.getBoundingClientRect();

    const geometry = {
      left:
        Math.round(
          rectangle.left
        ),
      top:
        Math.round(
          rectangle.top
        ),
      width:
        Math.round(
          rectangle.width
        ),
      height:
        Math.round(
          rectangle.height
        )
    };

    if (
      !isValidPanelGeometry(
        geometry
      )
    ) {
      return;
    }

    cachedPanelGeometry =
      geometry;

    try {
      await chrome.storage.local.set({
        [PANEL_GEOMETRY_KEY]:
          geometry
      });
    } catch (error) {
      console.warn(
        "Could not save panel geometry:",
        error
      );
    }
  }

  function keepPanelOnScreen(
    panel
  ) {
    if (
      !panel ||
      !panel.isConnected
    ) {
      return;
    }

    const rectangle =
      panel.getBoundingClientRect();

    let left =
      rectangle.left;

    let top =
      rectangle.top;

    if (
      rectangle.right >
      window.innerWidth
    ) {
      left = Math.max(
        0,
        window.innerWidth -
        rectangle.width
      );
    }

    if (
      rectangle.bottom >
      window.innerHeight
    ) {
      top = Math.max(
        0,
        window.innerHeight -
        rectangle.height
      );
    }

    if (left < 0) {
      left = 0;
    }

    if (top < 0) {
      top = 0;
    }

    if (
      left !== rectangle.left ||
      top !== rectangle.top
    ) {
      panel.style.left =
        `${left}px`;

      panel.style.top =
        `${top}px`;

      panel.style.right =
        "auto";
    }
  }

  function scrollToNewestTranslation(
    scrollingBody
  ) {
    if (!scrollingBody) {
      return;
    }

    const scrollToBottom = (
      behavior = "auto"
    ) => {
      if (
        !scrollingBody.isConnected
      ) {
        return;
      }

      scrollingBody.scrollTo({
        top:
          scrollingBody.scrollHeight,
        behavior
      });
    };

    requestAnimationFrame(() => {
      scrollToBottom("auto");

      requestAnimationFrame(() => {
        scrollToBottom("smooth");
      });
    });

    setTimeout(() => {
      scrollToBottom("smooth");
    }, 150);

    setTimeout(() => {
      scrollToBottom("smooth");
    }, 500);

    setTimeout(() => {
      scrollToBottom("smooth");
    }, 1000);
  }

  function getOrderedHistory(
    history,
    currentText
  ) {
    const ordered =
      Array.isArray(history)
        ? history
            .filter((entry) => {
              return (
                entry &&
                typeof entry.text ===
                  "string"
              );
            })
            .map((entry) => ({
              ...entry
            }))
        : [];

    ordered.sort(
      (first, second) => {
        return (
          getEntryTimestamp(first) -
          getEntryTimestamp(second)
        );
      }
    );

    if (
      ordered.length === 0 &&
      typeof currentText ===
        "string" &&
      currentText.trim()
    ) {
      ordered.push({
        id:
          `temporary-${Date.now()}`,
        text:
          currentText.trim(),
        imageDataUrl: "",
        createdAt:
          new Date().toISOString()
      });
    }

    return ordered.slice(-5);
  }

  function getEntryTimestamp(
    entry
  ) {
    const timestamp =
      new Date(
        entry?.createdAt || 0
      ).getTime();

    return Number.isFinite(
      timestamp
    )
      ? timestamp
      : 0;
  }

  function createButton(
    label,
    background
  ) {
    const button =
      document.createElement(
        "button"
      );

    button.type = "button";
    button.textContent = label;

    Object.assign(button.style, {
      minWidth: "0",
      padding: "0.7em 0.85em",
      border: "0",
      borderRadius: "0.5em",
      cursor: "pointer",
      background,
      color: "#ffffff",
      fontFamily:
        "system-ui, sans-serif",
      fontSize: "0.86em",
      fontWeight: "600"
    });

    return button;
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

      button.textContent =
        "Copied";
    } catch {
      button.textContent =
        "Copy failed";
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
      document.createElement(
        "div"
      );

    modal.id =
      IDS.imageModal;

    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      boxSizing: "border-box",
      background:
        "rgba(0, 0, 0, 0.88)",
      cursor: "zoom-out"
    });

    const modalContent =
      document.createElement(
        "div"
      );

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
      document.createElement(
        "img"
      );

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
      document.createElement(
        "button"
      );

    closeButton.type =
      "button";

    closeButton.textContent =
      "×";

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
        document.createElement(
          "div"
        );

      caption.textContent =
        translationText;

      Object.assign(
        caption.style,
        {
          width:
            "min(800px, 90vw)",
          maxHeight: "120px",
          overflow: "auto",
          boxSizing:
            "border-box",
          padding: "10px 12px",
          borderRadius: "8px",
          background: "#111827",
          color: "#f3f4f6",
          whiteSpace:
            "pre-wrap",
          overflowWrap:
            "anywhere",
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

    const onKeyDown = (
      event
    ) => {
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
        if (
          event.target === modal
        ) {
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
      typeof modal
        .__tamuKeydownHandler ===
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

  function formatHistoryTime(
    value
  ) {
    if (!value) {
      return "Previous translation";
    }

    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
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
    const element =
      document.getElementById(id);

    if (!element) {
      return;
    }

    clearTimeout(
      element.__tamuGeometrySaveTimer
    );

    if (
      element.__tamuResizeObserver
    ) {
      element
        .__tamuResizeObserver
        .disconnect();
    }

    if (
      typeof element
        .__tamuDragCleanup ===
      "function"
    ) {
      element.__tamuDragCleanup();
    }

    element.remove();
  }
})();
