import React from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = {
  default: 'bg-[#A0AEC0] hover:bg-[#718096] text-white shadow-md',
  primary: 'bg-[#007AFF] hover:bg-blue-600 text-white shadow-blue-200',
  outline: 'border border-blue-200 text-blue-500 hover:bg-blue-50 hover:text-blue-600',
  ghost: 'hover:bg-gray-100 text-gray-600',
  destructive: 'bg-red-500 hover:bg-red-600 text-white',
}

const buttonSizes = {
  default: 'h-10 px-4 py-2',
  sm: 'h-8 px-3 text-sm',
  lg: 'h-12 px-6 text-lg',
  icon: 'h-10 w-10',
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  disabled,
  children,
  ...props
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed',
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

export default Button
