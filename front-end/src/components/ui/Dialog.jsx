import React from 'react'

function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

export function Dialog({ open, onOpenChange, children }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="fixed inset-0 zeiss-overlay animate-fadeIn"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-50">
        {children}
      </div>
    </div>
  )
}

export function DialogContent({ className, children, ...props }) {
  return (
    <div
      className={cn('zeiss-dialog p-8 max-w-[500px] w-full mx-4 animate-scaleIn', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function DialogHeader({ className, children, ...props }) {
  return (
    <div className={cn('mb-6', className)} {...props}>
      {children}
    </div>
  )
}

export function DialogTitle({ className, children, ...props }) {
  return (
    <h2 className={cn('text-xl font-bold', className)} style={{ color: 'var(--text-primary)' }} {...props}>
      {children}
    </h2>
  )
}

export default Dialog
