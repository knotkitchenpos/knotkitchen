import React, { useState } from "react";
import { submitReview } from "../api";
import { Stars } from "./StoreReviews";

// Why there is no form, one line each (GET /api/eats/orders/:token review.reason).
const REASONS = {
  NOT_COMPLETED: "You can rate this order once it's completed.",
  CANCELLED: "Cancelled orders can't be rated.",
  EXPIRED: "Ratings close 14 days after the order.",
  ALREADY_REVIEWED: "You've already rated this order.",
};

/**
 * Rate a completed Knot Eats order: one review per order, through the order's
 * signed link (no accounts). Real radios inside a fieldset, so keyboard and
 * screen readers get a proper 1-5 choice; the stars are only their look.
 */
export default function ReviewForm({ token, review, onSaved }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (review?.existing) {
    return (
      <div className="text-[15px]">
        <p className="font-semibold text-slate-900">
          You rated {review.existing.rating}★ <Stars rating={review.existing.rating} />
        </p>
        {review.existing.text ? <p className="mt-1 whitespace-pre-line break-words text-slate-700">{review.existing.text}</p> : null}
      </div>
    );
  }
  if (!review?.canReview) {
    return <p className="text-[14px] text-slate-600">{REASONS[review?.reason] || "This order can't be rated."}</p>;
  }

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) return setError("Choose a rating from 1 to 5 stars.");
    setSaving(true);
    setError("");
    try {
      const res = await submitReview(token, { rating, text: text.trim() });
      onSaved(res.data.data.review);
    } catch (err) {
      setError(err.response?.data?.message || "We couldn't save your rating. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <fieldset>
        <legend className="text-[15px] font-semibold text-slate-900">How was your order?</legend>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
                required
                className="peer sr-only"
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
              />
              <span
                aria-hidden="true"
                className={`flex h-11 w-11 items-center justify-center rounded-lg text-[30px] leading-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${
                  n <= rating ? "text-[color:var(--ke-ok,#B45309)]" : "text-slate-300"
                }`}
              >
                ★
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="ke-review-text" className="text-[14px] text-slate-700">
          Tell others about it (optional)
        </label>
        <textarea
          id="ke-review-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          rows={3}
          aria-describedby="ke-review-count"
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-[15px] focus:border-brand focus:outline-none"
        />
        <p id="ke-review-count" className="text-right text-[12px] text-slate-500">
          {text.length}/500
        </p>
      </div>
      <p className="text-[13px] text-slate-500">
        {review.authorName
          ? `Your review will show as ${review.authorName}.`
          : "Your review will show as your first name and last initial."}
      </p>
      {error ? (
        <p role="alert" className="text-[14px] text-red-600">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="min-h-[44px] w-full rounded-xl bg-brand font-semibold text-brand-fg disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        {saving ? "Saving…" : "Submit rating"}
      </button>
    </form>
  );
}
