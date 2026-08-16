import React, { useState, useRef } from "react";
import { motion } from "framer-motion";
import { IoMdClose } from "react-icons/io";
import {
  FiDownload,
  FiUploadCloud,
  FiFileText,
  FiAlertTriangle,
  FiCheckCircle,
  FiBookOpen,
  FiArrowLeft,
} from "react-icons/fi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMenuImportFormat, previewMenuImport, importMenuText } from "../../https";
import { enqueueSnackbar } from "notistack";

/**
 * Structured Text (Notepad) Menu Import.
 *
 * Employee flow: download template -> fill it in -> upload -> fix any errors
 * -> review the preview -> import. All parsing happens server-side, so the
 * employee never sees any of the technical detail.
 */
const MenuTextImportModal = ({ onClose }) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState("upload"); // upload | errors | preview
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [errors, setErrors] = useState([]);
  const [preview, setPreview] = useState(null);
  const [showDocs, setShowDocs] = useState(false);
  const [mode, setMode] = useState("merge");
  const [isDragging, setIsDragging] = useState(false);

  const { data: formatRes } = useQuery({
    queryKey: ["menu-import-format"],
    queryFn: getMenuImportFormat,
  });

  const format = formatRes?.data?.data;

  // ----- Download the template -----
  const handleDownloadTemplate = () => {
    const template = format?.template;
    if (!template) {
      enqueueSnackbar("Template is still loading, please try again in a moment.", { variant: "info" });
      return;
    }

    const blob = new Blob([template], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "knotkitchen-menu-template.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    enqueueSnackbar("Template downloaded! Fill it in with Notepad and upload it here.", {
      variant: "success",
    });
  };

  // ----- Upload + validate -----
  const previewMutation = useMutation({
    mutationFn: previewMenuImport,
    onSuccess: (res) => {
      const data = res?.data?.data;
      if (data?.valid) {
        setPreview(data);
        setErrors([]);
        setStep("preview");
      } else {
        setErrors(data?.errors || []);
        setPreview(null);
        setStep("errors");
      }
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Could not read that file.", {
        variant: "error",
      });
    },
  });

  const readFile = (file) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".txt")) {
      enqueueSnackbar("Please upload a .txt file saved from Notepad.", { variant: "error" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target.result || "");
      setFileName(file.name);
      setFileText(text);
      previewMutation.mutate(text);
    };
    reader.onerror = () => {
      enqueueSnackbar("Could not read that file. Please try again.", { variant: "error" });
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e) => {
    readFile(e.target.files?.[0]);
    e.target.value = ""; // allow re-uploading the same filename after a fix
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    readFile(e.dataTransfer.files?.[0]);
  };

  // ----- Import -----
  const importMutation = useMutation({
    mutationFn: importMenuText,
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Menu imported successfully!", { variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["menus"] });
      onClose();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to import the menu.", {
        variant: "error",
      });
    },
  });

  const handleImport = () => importMutation.mutate({ text: fileText, mode });

  const resetToUpload = () => {
    setStep("upload");
    setErrors([]);
    setPreview(null);
    setFileName("");
    setFileText("");
  };

  const stats = preview?.stats;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-surface rounded-2xl border border-border w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/10 text-accent">
              <FiFileText size={18} />
            </div>
            <div>
              <h2 className="font-display font-semibold text-content text-lg">
                Structured Text Import
              </h2>
              <p className="text-xs text-content-muted">
                Build a full menu from a Notepad file
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-content-muted hover:text-content hover:bg-surface-tertiary transition-colors"
          >
            <IoMdClose size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {/* ---------------- FORMAT DOCS ---------------- */}
          {showDocs ? (
            <div className="space-y-4">
              <button
                onClick={() => setShowDocs(false)}
                className="flex items-center gap-1.5 text-sm text-accent hover:underline"
              >
                <FiArrowLeft size={14} /> Back
              </button>

              <div>
                <h3 className="font-display font-semibold text-content mb-1">Format Instructions</h3>
                <p className="text-sm text-content-muted">
                  Follow this structure exactly. Anything that does not match will be reported with
                  its line number so it is easy to correct.
                </p>
              </div>

              {(format?.sections || []).map((section) => (
                <div key={section.id} className="card p-4">
                  <h4 className="font-semibold text-content text-sm mb-1">{section.title}</h4>
                  <p className="text-sm text-content-muted mb-3">{section.body}</p>
                  <pre className="bg-surface-tertiary rounded-lg p-3 text-xs text-content-secondary font-mono overflow-x-auto whitespace-pre">
                    {section.example}
                  </pre>
                </div>
              ))}

              <div className="card p-4">
                <h4 className="font-semibold text-content text-sm mb-3">All Commands</h4>
                <div className="space-y-2">
                  {(format?.commands || []).map((cmd) => (
                    <div key={cmd.command} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                      <code className="text-xs font-mono text-accent shrink-0 w-40">{cmd.usage}</code>
                      <span className="text-xs text-content-muted">{cmd.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* ---------------- STEP 1: UPLOAD ---------------- */}
              {step === "upload" && (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      onClick={handleDownloadTemplate}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-accent text-white font-medium text-sm hover:opacity-90 transition-opacity"
                    >
                      <FiDownload size={16} />
                      Download Menu Template
                    </button>
                    <button
                      onClick={() => setShowDocs(true)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border text-content-secondary font-medium text-sm hover:border-accent hover:text-accent transition-colors"
                    >
                      <FiBookOpen size={16} />
                      View Format Instructions
                    </button>
                  </div>

                  <ol className="text-sm text-content-muted space-y-1.5 list-decimal list-inside">
                    <li>Download the template above.</li>
                    <li>Type the restaurant&apos;s menu into it using Notepad.</li>
                    <li>Save the file as a <span className="font-mono text-xs">.txt</span> file.</li>
                    <li>Upload it below to check and preview it.</li>
                  </ol>

                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl px-6 py-10 text-center cursor-pointer transition-colors ${
                      isDragging ? "border-accent bg-accent/5" : "border-border hover:border-accent"
                    }`}
                  >
                    <FiUploadCloud size={32} className="mx-auto text-content-muted mb-3" />
                    <p className="text-content font-medium text-sm">
                      {previewMutation.isPending ? "Checking your file..." : "Upload your menu file"}
                    </p>
                    <p className="text-xs text-content-muted mt-1">
                      Click to browse or drag your .txt file here
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,text/plain"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                </div>
              )}

              {/* ---------------- STEP 2: ERRORS ---------------- */}
              {step === "errors" && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-accent-red/10 border border-accent-red/20">
                    <FiAlertTriangle className="text-accent-red shrink-0 mt-0.5" size={18} />
                    <div>
                      <p className="font-semibold text-accent-red text-sm">
                        {errors.length} problem{errors.length === 1 ? "" : "s"} found in {fileName}
                      </p>
                      <p className="text-xs text-content-muted mt-0.5">
                        Nothing has been imported. Fix the lines below in Notepad, save, and upload
                        the file again.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {errors.map((error, index) => (
                      <div key={index} className="card p-4">
                        <p className="text-xs font-semibold text-accent-red mb-1.5">
                          {error.line > 0 ? `Line ${error.line}` : "File"}
                        </p>
                        {error.content && (
                          <pre className="bg-surface-tertiary rounded-lg px-3 py-2 text-xs font-mono text-content-secondary mb-2 overflow-x-auto whitespace-pre-wrap">
                            {error.content}
                          </pre>
                        )}
                        <p className="text-sm text-content">{error.message}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ---------------- STEP 3: PREVIEW ---------------- */}
              {step === "preview" && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-accent-green/10 border border-accent-green/20">
                    <FiCheckCircle className="text-accent-green shrink-0 mt-0.5" size={18} />
                    <div>
                      <p className="font-semibold text-accent-green text-sm">
                        {fileName} looks good
                      </p>
                      <p className="text-xs text-content-muted mt-0.5">
                        Check the menu below, then click Import Menu to add it.
                      </p>
                    </div>
                  </div>

                  {stats && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: "Categories", value: stats.categories },
                        { label: "Items", value: stats.items },
                        { label: "Variants", value: stats.variants },
                        { label: "Option Groups", value: stats.modifierGroups },
                      ].map((stat) => (
                        <div key={stat.label} className="card p-3 text-center">
                          <p className="font-display font-semibold text-content text-xl">
                            {stat.value}
                          </p>
                          <p className="text-xs text-content-muted">{stat.label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <h4 className="font-semibold text-content text-sm mb-2">Menu Preview</h4>
                    <pre className="bg-surface-tertiary rounded-xl p-4 text-xs font-mono text-content-secondary overflow-x-auto whitespace-pre leading-relaxed">
                      {preview?.tree}
                    </pre>
                  </div>

                  <div>
                    <h4 className="font-semibold text-content text-sm mb-2">
                      If a category already exists
                    </h4>
                    <div className="space-y-2">
                      {[
                        {
                          value: "merge",
                          title: "Add to it",
                          description:
                            "Keeps existing dishes and adds the new ones. Dishes with the same name are updated.",
                        },
                        {
                          value: "replace",
                          title: "Replace it",
                          description:
                            "Removes all existing dishes in that category and uses only the uploaded ones.",
                        },
                      ].map((option) => (
                        <label
                          key={option.value}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                            mode === option.value
                              ? "border-accent bg-accent/5"
                              : "border-border hover:border-accent/50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="import-mode"
                            value={option.value}
                            checked={mode === option.value}
                            onChange={() => setMode(option.value)}
                            className="mt-1 accent-current"
                          />
                          <div>
                            <p className="text-sm font-medium text-content">{option.title}</p>
                            <p className="text-xs text-content-muted">{option.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!showDocs && step !== "upload" && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-3 shrink-0">
            <button
              onClick={resetToUpload}
              className="px-4 py-2.5 rounded-xl border border-border text-content-secondary text-sm font-medium hover:border-accent hover:text-accent transition-colors"
            >
              Upload a different file
            </button>

            {step === "preview" && (
              <button
                onClick={handleImport}
                disabled={importMutation.isPending}
                className="px-6 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {importMutation.isPending ? "Importing..." : "Import Menu"}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default MenuTextImportModal;
