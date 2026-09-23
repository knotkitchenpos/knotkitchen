// A small copy of an uploaded photo for the menu cards: the backend makes
// `?w=160|320|640` versions (pos-backend/middlewares/imageThumbnail.js).
// Full-size photos in a long menu run low-end devices out of image memory.
// Other URLs are returned unchanged.
export const thumbUrl = (url, w) =>
  typeof url === "string" && /\/uploads\/[^?#]+\.(webp|png|jpe?g)$/i.test(url) ? `${url}?w=${w}` : url;
