(() => {
  /*
   * Prevent duplicate listeners when this file is injected multiple times
   * into the same browser tab.
   */
  if (window.__tamuOcrTranslatorLoaded) {
    return;
  }

  window.__tamuOcrTranslatorLoaded = true;

  const IDS = {
    selectionOverlay:
      "__tamu_ocr_selection_overlay",
    selectionBox:
      "__tamu_ocr_selection_box",
    resultPanel:
      "__tamu_ocr_result_panel"
  };

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {
      if (message.type === "OCR_START_SELECTION") {
        startSelection();

        sendResponse({
          ok: true
        });

        return;
      }

      if (message.type === "OCR_CROP_SCREENSHOT") {
        cropScreenshot(
          message.screenshotDataUrl,
          message.selection
        )
          .then((imageDataUrl) => {
            sendResponse({
              ok: true,
              imageDataUrl
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

        sendResponse({
          ok: true
        });

        return;
      }

      if (message.type === "OCR_SHOW_RESULT") {
        showResultPanel({
          text: message.text,
          error: message.error
        });

        sendResponse({
          ok: true
        });
      }
    }
  );

  function startSelection() {
    removeElement(IDS.selectionOverlay);
    removeElement(IDS.resultPanel);

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
      boxShadow:
        "0 8px 30px rgba(0, 0, 0, 0.3)",
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
        overlay.setPointerCapture(
          event.pointerId
        );
      } catch {
        /*
         * Pointer capture is useful but is not required.
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

    const image =
      await loadImage(screenshotDataUrl);

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

    if (
      sourceWidth <= 0 ||
      sourceHeight <= 0
    ) {
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
    error
  }) {
    removeElement(IDS.resultPanel);

    const panel =
      document.createElement("section");

    panel.id = IDS.resultPanel;

    Object.assign(panel.style, {
      position: "fixed",
      top: "18px",
      right: "18px",
      zIndex: "2147483647",
      width:
        "min(420px, calc(100vw - 36px))",
      maxHeight:
        "calc(100vh - 36px)",
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
      font:
        "14px/1.55 system-ui, sans-serif"
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
        "English translation";
    }

    const closeButton =
      document.createElement("button");

    closeButton.type = "button";
    closeButton.textContent = "×";

    closeButton.setAttribute(
      "aria-label",
      "Close"
    );

    Object.assign(closeButton.style, {
      width: "30px",
      height: "30px",
      padding: "0",
      border: "0",
      borderRadius: "6px",
      cursor: "pointer",
      background: "#374151",
      color: "#ffffff",
      font:
        "22px/30px system-ui, sans-serif"
    });

    closeButton.addEventListener(
      "click",
      () => {
        panel.remove();
      }
    );

    header.append(
      title,
      closeButton
    );

    const body =
      document.createElement("div");

    body.textContent =
      error ||
      status ||
      text ||
      "No text was returned.";

    Object.assign(body.style, {
      color:
        error
          ? "#fca5a5"
          : "#f3f4f6",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere"
    });

    panel.append(
      header,
      body
    );

    if (text && !error && !status) {
      const copyButton =
        document.createElement("button");

      copyButton.type = "button";
      copyButton.textContent =
        "Copy translation";

      Object.assign(copyButton.style, {
        marginTop: "14px",
        padding: "8px 12px",
        border: "0",
        borderRadius: "7px",
        cursor: "pointer",
        background: "#2563eb",
        color: "#ffffff",
        font:
          "600 12px system-ui, sans-serif"
      });

      copyButton.addEventListener(
        "click",
        async () => {
          try {
            await navigator.clipboard.writeText(
              text
            );

            copyButton.textContent =
              "Copied";
          } catch {
            copyButton.textContent =
              "Copy failed";
          }
        }
      );

      panel.appendChild(copyButton);
    }

    document.documentElement.appendChild(
      panel
    );
  }

  function removeElement(id) {
    document.getElementById(id)?.remove();
  }
})();
