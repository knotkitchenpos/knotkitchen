import React from 'react'
import { FiArrowLeft } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'

const BackButton = ({ text }) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(-1)}
      className="flex items-center gap-2 py-2 px-3 rounded-xl bg-surface-secondary border border-border hover:border-accent hover:text-accent transition-all text-content-secondary font-medium text-sm"
    >
      <FiArrowLeft size={16} />
      {text || "Back"}
    </button>
  )
}

export default BackButton