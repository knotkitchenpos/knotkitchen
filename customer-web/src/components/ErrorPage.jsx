import React from "react";

export default function ErrorPage({ title = "Something went wrong", message }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center">
        <div className="text-5xl mb-4" aria-hidden="true">🕒</div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-slate-500 text-sm">{message || "Please try again in a moment."}</p>
      </div>
    </div>
  );
}
