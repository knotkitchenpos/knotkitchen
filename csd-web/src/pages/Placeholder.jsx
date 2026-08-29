import React from "react";
import { FiClock } from "react-icons/fi";

/**
 * Stands in for a module that is routed and access-controlled but not yet
 * built. Deliberately explicit about which phase delivers it, so a reviewer
 * can tell "not built yet" apart from "built and broken".
 */
const Placeholder = ({ title, phase }) => (
  <div className="mx-auto max-w-3xl">
    <h1 className="text-2xl font-bold text-navy-900">{title}</h1>
    <div className="mt-5 flex items-start gap-3 rounded-2xl border border-dashed border-navy-300 bg-white p-6">
      <FiClock className="mt-0.5 shrink-0 text-navy-400" aria-hidden="true" />
      <div>
        <p className="font-medium text-navy-800">Arriving in phase {phase}</p>
        <p className="mt-1 text-sm text-navy-500">
          Routing and role-based access for this section are already in place and
          enforced on the server. The screen itself is not built yet.
        </p>
      </div>
    </div>
  </div>
);

export default Placeholder;
