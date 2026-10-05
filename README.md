# TAMU Japanese/Korean OCR Translator

A Chrome extension that lets you select Japanese or Korean text visible on a
webpage and translate it into English through the TAMU AI API.

## Features

- Works in Chrome on macOS
- Drag to select a visible area of a webpage
- Japanese and Korean OCR
- English translation
- Uses a user-provided TAMU AI API key
- Keeps the key in Chrome session storage
- Includes a button to copy the translation

## Privacy

The extension captures only the visible rectangular area selected by the user.
That image is sent to:

https://chat-api.tamu.ai

The API key is entered through the extension popup and is not included in this
repository. Do not commit API keys to GitHub.

## Install

1. Download or clone this repository.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the repository folder.
7. Pin the extension to the Chrome toolbar.

## Use

1. Open a normal webpage containing Japanese or Korean text.
2. Click the extension icon.
3. Enter your TAMU AI API key.
4. Confirm the vision model.
5. Click **Select text to translate**.
6. Drag a rectangle around the text.
7. Wait for the English translation.

## Default model

The default model is:

protected.gemini-2.0-flash-lite

If it does not support image input for your account, replace it in the popup
with another vision-capable model returned by the TAMU models API.

## Limitations

Chrome extensions cannot run on protected pages such as:

- `chrome://extensions`
- The Chrome Web Store
- Some built-in PDF or browser pages

The text must be visible in the current browser window.
