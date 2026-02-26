import React, { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

export function Select({ value, onValueChange, placeholder, children, className }) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState('')
  const selectRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (selectRef.current && !selectRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (itemValue, label) => {
    onValueChange(itemValue)
    setSelectedLabel(label)
    setIsOpen(false)
  }

  return (
    <div ref={selectRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex h-11 w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 focus:bg-white',
          'transition-all duration-200'
        )}
      >
        <span className={value ? 'text-gray-700' : 'text-gray-400'}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
      </button>
      
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-60 overflow-auto">
          {React.Children.map(children, child => {
            if (React.isValidElement(child)) {
              return React.cloneElement(child, { onSelect: handleSelect })
            }
            return child
          })}
        </div>
      )}
    </div>
  )
}

export function SelectItem({ value, children, onSelect }) {
  return (
    <div
      onClick={() => onSelect(value, children)}
      className="px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 cursor-pointer transition-colors"
    >
      {children}
    </div>
  )
}

export default Select
