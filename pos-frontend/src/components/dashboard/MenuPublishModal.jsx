import React, { useState } from "react";
import { motion } from "framer-motion";
import { IoMdClose } from "react-icons/io";
import { FiUploadCloud, FiClock, FiRotateCcw, FiCheckCircle, FiXCircle } from "react-icons/fi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { publishMenu, unpublishMenu, getMenuVersions, rollbackMenu } from "../../https";
import { enqueueSnackbar } from "notistack";

const MenuPublishModal = ({ menu, onClose }) => {
  const queryClient = useQueryClient();

  const { data: versionsRes } = useQuery({
    queryKey: ["menu-versions", menu?._id],
    queryFn: () => getMenuVersions(menu?._id),
    enabled: Boolean(menu?._id),
  });

  const versionsData = versionsRes?.data?.data;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["menus"] });
    queryClient.invalidateQueries({ queryKey: ["menu-versions"] });
  };

  const publishMutation = useMutation({
    mutationFn: () => publishMenu(menu?._id),
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Menu published!", { variant: "success" });
      invalidate();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to publish menu.", { variant: "error" });
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: () => unpublishMenu(menu?._id),
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Menu unpublished!", { variant: "success" });
      invalidate();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to unpublish menu.", { variant: "error" });
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: (version) => rollbackMenu({ menuId: menu?._id, version }),
    onSuccess: (res) => {
      enqueueSnackbar(res?.data?.message || "Menu rolled back!", { variant: "success" });
      invalidate();
    },
    onError: (error) => {
      enqueueSnackbar(error.response?.data?.message || "Failed to rollback menu.", { variant: "error" });
    },
  });

  const handleRollback = (version) => {
    if (window.confirm(`Roll back "${menu?.name}" to version ${version}? This will replace the current menu.`)) {
      rollbackMutation.mutate(version);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-secondary rounded-2xl shadow-2xl w-full max-w-lg mx-4 border border-border overflow-y-auto max-h-[90vh]"
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-border sticky top-0 bg-surface-secondary">
          <h2 className="font-display text-lg text-content font-semibold">
            Publish & Versions - {menu?.name}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-content-muted hover:text-accent-red hover:bg-surface-tertiary transition-all"
          >
            <IoMdClose size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Current Status */}
          <div className={`rounded-xl p-4 border flex items-center justify-between gap-3 ${
            versionsData?.published
              ? "bg-accent-green/10 border-accent-green/30"
              : "bg-accent-red/10 border-accent-red/30"
          }`}>
            <div className="flex items-center gap-3">
              {versionsData?.published ? (
                <FiCheckCircle className="text-accent-green text-2xl shrink-0" />
              ) : (
                <FiXCircle className="text-accent-red text-2xl shrink-0" />
              )}
              <div>
                <p className={`font-semibold ${
                  versionsData?.published ? "text-accent-green" : "text-accent-red"
                }`}>
                  {versionsData?.published ? "Published" : "Unpublished"}
                </p>
                <p className="text-xs text-content-muted">
                  Current version: v{versionsData?.currentVersion ?? menu?.version ?? 1}
                  {versionsData?.publishedAt && (
                    <> · {formatDate(versionsData.publishedAt)}</>
                  )}
                </p>
              </div>
            </div>
            {versionsData?.published ? (
              <button
                onClick={() => unpublishMutation.mutate()}
                disabled={unpublishMutation.isPending}
                className="btn-secondary !py-2 !px-3 text-sm shrink-0 disabled:opacity-50"
              >
                {unpublishMutation.isPending ? "..." : "Unpublish"}
              </button>
            ) : (
              <button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending}
                className="btn-primary !py-2 !px-3 text-sm shrink-0 disabled:opacity-50 flex items-center gap-1.5"
              >
                <FiUploadCloud size={14} />
                {publishMutation.isPending ? "Publishing..." : "Publish"}
              </button>
            )}
          </div>

          {/* Version History */}
          <div>
            <h3 className="font-semibold text-content mb-3 flex items-center gap-2 text-sm">
              <FiClock size={16} className="text-content-muted" />
              Version History
            </h3>

            {versionsData?.history?.length > 0 ? (
              <div className="space-y-2">
                {[...(versionsData.history)].reverse().map((v) => (
                  <div
                    key={v.version}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                      v.version === versionsData.currentVersion
                        ? "border-accent bg-accent/5"
                        : "border-border bg-surface-input"
                    }`}
                  >
                    <div>
                      <p className="font-semibold text-content text-sm">
                        Version {v.version}
                        {v.version === versionsData.currentVersion && (
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-semibold">
                            Current
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-content-muted">
                        {formatDate(v.publishedAt)}
                      </p>
                      <p className="text-xs text-content-muted mt-1">
                        {(v.snapshot?.items?.length || 0)} dishes · {v.snapshot?.name || menu?.name}
                      </p>
                    </div>
                    {v.version !== versionsData.currentVersion && (
                      <button
                        onClick={() => handleRollback(v.version)}
                        disabled={rollbackMutation.isPending}
                        className="flex items-center gap-1.5 text-xs text-accent hover:underline shrink-0 disabled:opacity-50"
                      >
                        <FiRotateCcw size={12} />
                        Rollback
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-content-muted text-sm rounded-xl border border-dashed border-border">
                No version history yet. Publish the menu to create version snapshots.
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default MenuPublishModal;