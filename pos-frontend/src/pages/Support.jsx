import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { enqueueSnackbar } from "notistack";
import { FiPrinter, FiGlobe, FiBell, FiHeadphones, FiX, FiPhoneCall, FiCheckCircle } from "react-icons/fi";

/* SVG Support Agent Illustration matching reference image */
const SupportIllustration = () => (
  <svg
    viewBox="0 0 450 350"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="w-full max-w-[380px] h-auto mx-auto"
  >
    {/* Calendar / Desk Shelf in Background */}
    <rect x="120" y="80" width="60" height="45" rx="4" fill="#F1F5F9" stroke="#CBD5E1" strokeWidth="1.5" strokeDasharray="3 3" />
    <circle cx="130" cy="90" r="1.5" fill="#94A3B8" />
    <circle cx="140" cy="90" r="1.5" fill="#94A3B8" />
    <circle cx="150" cy="90" r="1.5" fill="#94A3B8" />
    <circle cx="160" cy="90" r="1.5" fill="#94A3B8" />
    <circle cx="130" cy="100" r="1.5" fill="#94A3B8" />
    <circle cx="140" cy="100" r="1.5" fill="#94A3B8" />
    <circle cx="150" cy="100" r="1.5" fill="#94A3B8" />
    <circle cx="160" cy="100" r="1.5" fill="#94A3B8" />
    <circle cx="130" cy="110" r="1.5" fill="#94A3B8" />
    <circle cx="140" cy="110" r="1.5" fill="#FD5302" />
    <circle cx="150" cy="110" r="1.5" fill="#94A3B8" />

    {/* Shelf books */}
    <line x1="220" y1="95" x2="300" y2="95" stroke="#E2E8F0" strokeWidth="3" strokeLinecap="round" />
    <rect x="235" y="65" width="12" height="30" rx="1" fill="#FDE68A" />
    <rect x="250" y="70" width="10" height="25" rx="1" fill="#BFDBFE" />
    <rect x="280" y="60" width="14" height="35" rx="1" fill="#FEF08A" />

    {/* Speech Bubble with ... */}
    <path
      d="M 175 90 C 150 90, 150 130, 175 130 C 182 130, 192 135, 198 142 C 196 133, 202 128, 208 123 C 220 115, 215 90, 175 90 Z"
      fill="#FDE68A"
    />
    <circle cx="180" cy="110" r="2.5" fill="#B45309" />
    <circle cx="190" cy="110" r="2.5" fill="#B45309" />
    <circle cx="200" cy="110" r="2.5" fill="#B45309" />

    {/* Computer Monitor */}
    <rect x="135" y="145" width="80" height="90" rx="4" fill="#93C5FD" />
    <path d="M 135 145 L 180 235 L 215 235 L 215 145 Z" fill="#60A5FA" opacity="0.6" />
    <rect x="170" y="235" width="15" height="25" fill="#94A3B8" />
    <ellipse cx="177" cy="260" rx="20" ry="4" fill="#CBD5E1" />

    {/* Plant on Left */}
    <path d="M 115 230 L 125 230 L 122 265 L 118 265 Z" fill="#D97706" />
    <path d="M 120 230 C 105 210, 95 200, 100 185 C 110 195, 115 215, 120 230 Z" fill="#F59E0B" />
    <path d="M 120 230 C 130 215, 140 205, 135 190 C 125 200, 122 215, 120 230 Z" fill="#D97706" />

    {/* Support Agent (Female with Headset) */}
    {/* Body / Shirt */}
    <path
      d="M 180 290 C 180 225, 230 200, 270 210 C 300 220, 300 290, 300 290 Z"
      fill="#2563EB"
    />
    <path
      d="M 180 290 C 180 225, 230 200, 270 210 C 300 220, 300 290, 300 290 Z"
      fill="url(#shirtDots)"
    />

    {/* Dots Pattern on Shirt */}
    <defs>
      <pattern id="shirtDots" width="10" height="10" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1" fill="#FDE68A" />
      </pattern>
    </defs>

    {/* Neck & Face */}
    <rect x="235" y="180" width="18" height="30" rx="4" fill="#FDBA74" />
    <path d="M 225 135 C 225 110, 265 110, 265 135 C 265 170, 225 170, 225 135 Z" fill="#FDBA74" />

    {/* Hair */}
    <path d="M 220 135 C 215 90, 275 80, 280 120 C 285 140, 290 190, 270 210 C 265 180, 265 140, 255 125 Z" fill="#1E1B4B" />
    <path d="M 220 130 C 220 100, 260 95, 265 115 C 250 115, 235 125, 225 145 Z" fill="#1E1B4B" />

    {/* Headset & Mic */}
    <path d="M 230 115 C 225 100, 260 95, 265 115" stroke="#1E293B" strokeWidth="4" fill="none" />
    <rect x="223" y="125" width="8" height="18" rx="3" fill="#1E293B" />
    <path d="M 225 138 C 235 148, 245 150, 255 145" stroke="#1E293B" strokeWidth="2.5" fill="none" />
    <circle cx="256" cy="145" r="3" fill="#1E293B" />

    {/* Arm & Hand at Desk */}
    <path d="M 200 270 C 190 270, 185 260, 220 260 L 250 255" stroke="#FDBA74" strokeWidth="14" strokeLinecap="round" />

    {/* Desk Top */}
    <rect x="80" y="270" width="280" height="8" rx="2" fill="#E2E8F0" />
  </svg>
);

const Support = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "KnotKitchen | Help & Support";
  }, []);

  // Callback modal state
  const [showCallbackModal, setShowCallbackModal] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [preferredTime, setPreferredTime] = useState("As soon as possible");
  const [notesInput, setNotesInput] = useState("");

  // Selected issue modal state
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [issueDetails, setIssueDetails] = useState("");

  const SUPPORT_OPTIONS = [
    {
      id: "printer",
      title: "Printer not working",
      desc: "Have printer issues? Our tech support is here to help you.",
      icon: <FiPrinter className="w-5 h-5 text-[#0F172A]" />,
      hint: "Paper jam, Bluetooth/USB offline, or receipt formatting issues",
    },
    {
      id: "website",
      title: "Website not working",
      desc: "Do you need help with your website functioning as expected? We will sort that out immediately.",
      icon: <FiGlobe className="w-5 h-5 text-[#0F172A]" />,
      hint: "Online ordering, domain mapping, or storefront loading issues",
    },
    {
      id: "menu",
      title: "Menu change request",
      desc: "Menu changes, last minute or pre-planned. Our executives will take care of the changes you need.",
      icon: <FiBell className="w-5 h-5 text-[#0F172A]" />,
      hint: "Bulk menu updates, category reorganization, or price updates",
    },
    {
      id: "other",
      title: "Other technical issues",
      desc: "Facing any other technical problems? Contact our support team directly.",
      icon: <FiHeadphones className="w-5 h-5 text-[#0F172A]" />,
      hint: "POS system, table session, reports, or billing queries",
    },
  ];

  const handleOptionClick = (option) => {
    setSelectedIssue(option);
    setIssueDetails("");
  };

  const handleSubmitIssueRequest = () => {
    if (!selectedIssue) return;
    enqueueSnackbar(`Support request submitted for "${selectedIssue.title}". Our team will contact you shortly!`, {
      variant: "success",
    });
    setSelectedIssue(null);
    setIssueDetails("");
  };

  const handleRequestCallback = () => {
    if (!phoneInput || phoneInput.trim().length < 10) {
      enqueueSnackbar("Please enter a valid 10-digit phone number for callback.", { variant: "warning" });
      return;
    }
    enqueueSnackbar("Callback requested successfully! Our support representative will call you shortly.", {
      variant: "success",
    });
    setShowCallbackModal(false);
    setPhoneInput("");
    setNotesInput("");
  };

  return (
    <div className="min-h-screen w-full bg-white text-[#0F172A] flex flex-col font-sans">

      {/* Header matching reference image */}
      <header className="w-full px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between bg-white shrink-0">
        <h1 className="text-[20px] font-bold text-[#0F172A] tracking-tight">Help & Support</h1>
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
          title="Close / Go Back"
        >
          <FiX className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content Area (Two Columns on Desktop) */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8 md:py-12 flex flex-col md:flex-row items-center md:items-start justify-between gap-10 md:gap-16">

        {/* Left Column: Illustration, Request Callback & Helpline */}
        <div className="w-full md:w-1/2 flex flex-col items-center text-center space-y-6">
          {/* Support Illustration */}
          <SupportIllustration />

          {/* Request A Call Back Primary Button */}
          <button
            onClick={() => setShowCallbackModal(true)}
            className="w-full max-w-[320px] h-[48px] rounded-xl bg-[#1C2029] text-white font-extrabold text-[14.5px] hover:bg-[#2A303C] transition-all shadow-md active:scale-[0.99] flex items-center justify-center gap-2"
          >
            <FiPhoneCall className="w-4 h-4" />
            <span>Request A Call Back</span>
          </button>

          {/* Support Helpline */}
          <div className="pt-2 text-center space-y-1">
            <p className="text-[13px] font-bold text-[#64748B]">Support Helpline</p>
            <a
              href="tel:+919876543210"
              className="text-[16px] font-extrabold text-[#0F172A] hover:text-[#C2410C] transition-colors block"
            >
              +91 98765 43210
            </a>
          </div>
        </div>

        {/* Right Column: Support Issue Cards */}
        <div className="w-full md:w-1/2 flex flex-col space-y-4">
          {SUPPORT_OPTIONS.map((option) => (
            <div
              key={option.id}
              onClick={() => handleOptionClick(option)}
              className="p-5 rounded-2xl bg-[#FDF6F2] border border-[#FBEDE4] hover:border-[#F7E5D8] hover:bg-[#FBEDE4] cursor-pointer transition-all shadow-sm group"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                  {option.icon}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="text-[15px] font-extrabold text-[#0F172A] group-hover:text-[#C2410C] transition-colors">
                    {option.title}
                  </h3>
                  <p className="text-[13px] text-[#64748B] font-medium leading-relaxed">
                    {option.desc}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Callback Request Modal */}
      {showCallbackModal && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-[440px] bg-white rounded-2xl p-6 shadow-2xl space-y-5 text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <h3 className="text-[18px] font-extrabold flex items-center gap-2">
                <FiPhoneCall className="text-[#C2410C]" />
                Request A Call Back
              </h3>
              <button
                onClick={() => setShowCallbackModal(false)}
                className="text-[#94A3B8] hover:text-[#0F172A]"
              >
                <FiX className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[13px] text-[#64748B]">
              Enter your contact phone number and preferred time. Our support executive will call you back.
            </p>

            <div className="space-y-3.5 text-[13px]">
              <div>
                <label className="text-[12px] font-bold text-[#475569] block mb-1">
                  Your Phone Number *
                </label>
                <input
                  type="tel"
                  maxLength={10}
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full h-[40px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A] focus:border-[#FD5302]"
                />
              </div>

              <div>
                <label className="text-[12px] font-bold text-[#475569] block mb-1">
                  Preferred Time
                </label>
                <select
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  className="w-full h-[40px] px-3 rounded-xl border border-[#E2E8F0] font-bold text-[#0F172A]"
                >
                  <option value="As soon as possible">As soon as possible</option>
                  <option value="In 15 minutes">In 15 minutes</option>
                  <option value="In 30 minutes">In 30 minutes</option>
                  <option value="Evening (after 6 PM)">Evening (after 6 PM)</option>
                </select>
              </div>

              <div>
                <label className="text-[12px] font-bold text-[#475569] block mb-1">
                  Brief Note (Optional)
                </label>
                <textarea
                  rows={2}
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Tell us what you need help with..."
                  className="w-full p-3 rounded-xl border border-[#E2E8F0] font-medium resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCallbackModal(false)}
                className="flex-1 h-[42px] rounded-xl border border-[#CBD5E1] font-bold text-[#475569] hover:bg-[#F8FAFC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRequestCallback}
                className="flex-1 h-[42px] rounded-xl bg-[#1C2029] text-white font-extrabold shadow-md hover:bg-[#2A303C]"
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selected Issue Request Modal */}
      {selectedIssue && (
        <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-[460px] bg-white rounded-2xl p-6 shadow-2xl space-y-5 text-[#0F172A]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#FDF6F2] flex items-center justify-center">
                  {selectedIssue.icon}
                </div>
                <h3 className="text-[17px] font-extrabold">{selectedIssue.title}</h3>
              </div>
              <button onClick={() => setSelectedIssue(null)} className="text-[#94A3B8] hover:text-[#0F172A]">
                <FiX className="w-5 h-5" />
              </button>
            </div>

            <p className="text-[13px] text-[#64748B] font-medium leading-relaxed">
              {selectedIssue.desc}
            </p>

            <div className="space-y-3 text-[13px]">
              <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-[12px] text-[#475569]">
                <span className="font-bold block text-[#0F172A] mb-0.5">Common Fix / Category:</span>
                {selectedIssue.hint}
              </div>

              <div>
                <label className="text-[12px] font-bold text-[#475569] block mb-1">
                  Describe Your Issue / Request
                </label>
                <textarea
                  rows={3}
                  value={issueDetails}
                  onChange={(e) => setIssueDetails(e.target.value)}
                  placeholder="Provide details so our tech executive can assist you faster..."
                  className="w-full p-3 rounded-xl border border-[#E2E8F0] font-medium text-[13px] resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedIssue(null)}
                className="flex-1 h-[42px] rounded-xl border border-[#CBD5E1] font-bold text-[#475569] hover:bg-[#F8FAFC]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitIssueRequest}
                className="flex-1 h-[42px] rounded-xl bg-[#1C2029] text-white font-extrabold shadow-md hover:bg-[#2A303C]"
              >
                Submit Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Support;
