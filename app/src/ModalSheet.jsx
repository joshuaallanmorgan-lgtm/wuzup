import { useCallback, useEffect, useRef } from 'react'
import './modal-sheet.css'

const FOCUSABLE = [
  '[data-modal-initial-focus]',
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableNodes(dialog) {
  if (!dialog) return []
  return [...dialog.querySelectorAll(FOCUSABLE)].filter((node) => (
    node.tabIndex >= 0
    && !node.matches(':disabled')
    && !node.closest('[hidden], [aria-hidden="true"], [inert]')
  ))
}

function focusWithoutScroll(node) {
  if (!node?.focus) return
  try {
    node.focus({ preventScroll: true })
  } catch {
    node.focus()
  }
}

// Shared modal/sheet behavior. Visual surfaces keep their own class names, while
// this primitive owns the interaction contract: modal semantics, focus-in,
// resilient Tab wrapping, capture-phase Escape, scrim dismissal, and exact
// trigger focus restoration after the surface actually unmounts.
export default function ModalSheet({
  children,
  className = '',
  scrimClassName = '',
  dialogClassName = '',
  label,
  labelledBy,
  closing = false,
  focusKey,
  onDismiss,
  returnFocusRef,
  resolveFallbackFocus,
}) {
  const layerRef = useRef(null)
  const dialogRef = useRef(null)
  const dismissRequestedRef = useRef(false)

  const isTopModal = useCallback(() => {
    const layers = document.querySelectorAll('[data-modal-sheet-layer]')
    return layers[layers.length - 1] === layerRef.current
  }, [])

  const dismiss = useCallback(() => {
    if (closing || dismissRequestedRef.current) return
    dismissRequestedRef.current = true
    onDismiss?.()
  }, [closing, onDismiss])

  useEffect(() => {
    const layer = layerRef.current
    const trigger = returnFocusRef?.current
    return () => {
      queueMicrotask(() => {
        // React StrictMode replays effect cleanup while the mounted layer is
        // still connected. Only restore after a real unmount. Action flows can
        // replace their launcher (add/move/remove), so resolve the fallback at
        // cleanup time after React has committed the resulting control.
        if (layer?.isConnected) return
        const target = trigger?.isConnected ? trigger : resolveFallbackFocus?.()
        if (target?.isConnected) focusWithoutScroll(target)
      })
    }
  }, [resolveFallbackFocus, returnFocusRef])

  useEffect(() => {
    const dialog = dialogRef.current
    const initial = dialog?.querySelector('[data-modal-initial-focus]')
      || focusableNodes(dialog)[0]
      || dialog
    focusWithoutScroll(initial)
  }, [focusKey])

  useEffect(() => {
    const onEscape = (event) => {
      if (event.key !== 'Escape' || !isTopModal()) return
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [dismiss, isTopModal])

  useEffect(() => {
    const onFocusIn = (event) => {
      const dialog = dialogRef.current
      if (!dialog || !isTopModal() || dialog.contains(event.target)) return
      focusWithoutScroll(focusableNodes(dialog)[0] || dialog)
    }
    document.addEventListener('focusin', onFocusIn, true)
    return () => document.removeEventListener('focusin', onFocusIn, true)
  }, [isTopModal])

  const trapTab = (event) => {
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    const nodes = focusableNodes(dialog)
    if (!nodes.length) {
      event.preventDefault()
      focusWithoutScroll(dialog)
      return
    }
    const current = nodes.indexOf(document.activeElement)
    if (event.shiftKey && current <= 0) {
      event.preventDefault()
      focusWithoutScroll(nodes[nodes.length - 1])
    } else if (!event.shiftKey && (current === -1 || current === nodes.length - 1)) {
      event.preventDefault()
      focusWithoutScroll(nodes[0])
    }
  }

  return (
    <div
      ref={layerRef}
      className={`modal-sheet-layer ${className}`.trim()}
      data-modal-sheet-layer
      data-closing={closing || undefined}
    >
      <button
        type="button"
        className={`modal-sheet-scrim ${scrimClassName}`.trim()}
        tabIndex={-1}
        aria-hidden="true"
        onClick={dismiss}
      />
      <div
        ref={dialogRef}
        className={`modal-sheet-dialog ${dialogClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        {children}
      </div>
    </div>
  )
}
