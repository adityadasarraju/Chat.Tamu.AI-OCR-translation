# TAMU OCR Translator

A Chrome extension that captures a selected area of a webpage, sends the cropped image to TAMU AI, performs OCR, and translates visible Japanese or Korean text into English.
You need to input your free Chat.Tamu.AI API Key which you can access by 1. opening chat.tamu.ai 2. then follow these intructions https://docs.tamus.ai/docs/prod/api-tool/create-and-test-api-key#steps-to-create-your-api-key
## Features

- Drag a rectangle around visible text
- Captures only the selected region for translation
- Sends the cropped image to the TAMU AI API
- Supports a dropdown for selecting different image-capable models
- Displays translations directly on the webpage
- Keeps a session history of the five most recent translations
- Displays the oldest translation at the top and newest at the bottom
- Stores a screenshot preview with each translation
- Click a screenshot preview to enlarge it
- Copy individual translations
- Start another translation without reopening the extension popup
- Works with Google Chrome on macOS

## Project structure

```text
tamu-ocr-translator/
├── manifest.json
├── popup.html
├── popup.css
├── popup.js
├── background.js
├── content.js
└── README.md
