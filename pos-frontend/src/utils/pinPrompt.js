/**
 * One Security PIN prompt for the whole POS.
 *
 * The API answers 403 with code PIN_REQUIRED when a staff member tries a
 * protected action without a fresh PIN. https/axiosWrapper.js then calls
 * requestPin(), GlobalPinPrompt shows the popup, and the request is retried
 * once the PIN is right. Screens no longer need their own PIN modal to work;
 * several never had one and just showed the error.
 */
let listener = null;
let pending = null;

/** GlobalPinPrompt registers here. Returns the unsubscribe. */
export const onPinRequest = (fn) => {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
};

/** Resolves when a valid PIN was entered, rejects if the popup is closed. */
export const requestPin = () => {
  if (!listener) return Promise.reject(new Error("PIN prompt is not available."));
  // Several requests refused at once share one popup.
  if (!pending) {
    pending = new Promise((resolve, reject) => listener({ resolve, reject })).finally(() => {
      pending = null;
    });
  }
  return pending;
};
