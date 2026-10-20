---
name: image-bridge
description: Use whenever a message contains an id starting with "img__" (for example img__3f2a9c1e-7b4d-4e1a-9c2f-0a1b2c3d4e5f). Such an id refers to an image the user uploaded through the local Image Bridge; fetch it with the image-bridge MCP tool get_image and look at it before answering.
---

# Image Bridge

The user's terminal cannot paste images, so they upload them in a browser at the Image Bridge UI and hand you the id instead. An id always has the form `img__<uuid>`.

When you see one:

1. Call the `image-bridge` MCP tool `get_image` with the id exactly as given (whitespace around it is fine). It returns the image itself plus its filename, type and size.
2. Answer the user's question from what you see. Do not guess at the content before fetching.
3. If several ids appear, fetch each one.
4. If the tool errors with "No image with id", say so; the user may have deleted it or pasted an old id. `list_images` shows what is currently uploaded.
5. If the tool is unavailable, the server is probably not running. Tell the user to start it (`npm run dev` in the cuxsor-help-tui project) and open http://127.0.0.1:3333/ui.

Never ask the user to describe the image or to paste it into the terminal; the whole point of the id is that they cannot.
