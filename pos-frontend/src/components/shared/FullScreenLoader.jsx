import React from 'react'
import { motion } from 'framer-motion'

const FullScreenLoader = () => {
  return (
    <div className='fullscreen-loader'>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col items-center gap-4"
      >
        <div className='loader-rings'>
          <div className='loader-ring' />
          <div className='loader-ring' />
          <div className='loader-ring' />
        </div>
        <motion.p
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="font-display font-semibold text-lg"
        >
          Loading <span className="gradient-text">KnotKitchen</span>...
        </motion.p>
      </motion.div>
    </div>
  )
}

export default FullScreenLoader