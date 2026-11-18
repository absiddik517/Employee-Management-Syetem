import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Module-level sheet stack coordinates body scroll lock, Escape handling, and underlay scaling.
let openSheetStack = [];
const stackListeners = new Set();

function notifyStack() {
  const snapshot = [...openSheetStack];
  stackListeners.forEach((fn) => fn(snapshot));
  if (typeof document !== 'undefined') {
    document.body.style.overflow = snapshot.length > 0 ? 'hidden' : '';
  }
}

function pushSheet(id) {
  if (!openSheetStack.includes(id)) {
    openSheetStack = [...openSheetStack, id];
    notifyStack();
  }
}

function removeSheet(id) {
  if (openSheetStack.includes(id)) {
    openSheetStack = openSheetStack.filter((item) => item !== id);
    notifyStack();
  }
}

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

export default function BottomSheet({
  open = false,
  onClose,
  title,
  subtitle = '',
  maxWidthClass = 'sm:max-w-xl',
  headerLeading = null,
  headerExtra = null,
  footer = null,
  children
}) {
  const sheetId = useId();
  const titleId = useId();
  const panelRef = useRef(null);
  const previousActiveRef = useRef(null);
  const dragStartYRef = useRef(null);
  const dragStartTimeRef = useRef(0);

  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(false);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [stack, setStack] = useState(() => [...openSheetStack]);

  useEffect(() => {
    const listener = (nextStack) => setStack(nextStack);
    stackListeners.add(listener);
    return () => {
      stackListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (open) {
      previousActiveRef.current = document.activeElement;
      setRendered(true);
      pushSheet(sheetId);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setEntered(true);
        });
      });
      return () => {
        cancelAnimationFrame(raf1);
        if (raf2) cancelAnimationFrame(raf2);
      };
    }

    setEntered(false);
    setDragOffsetY(0);
    setDragging(false);
    removeSheet(sheetId);

    const timer = setTimeout(() => {
      setRendered(false);
      if (previousActiveRef.current && typeof previousActiveRef.current.focus === 'function') {
        try {
          previousActiveRef.current.focus({ preventScroll: true });
        } catch {
          // ignore focus restoration error
        }
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [open, sheetId]);

  useEffect(() => {
    return () => {
      removeSheet(sheetId);
    };
  }, [sheetId]);

  const stackIndex = stack.indexOf(sheetId);
  const isTopmost = stackIndex !== -1 && stackIndex === stack.length - 1;
  const isUnderlay = stackIndex !== -1 && stackIndex < stack.length - 1;
  const zIndex = 50 + (stackIndex >= 0 ? stackIndex * 10 : 0);

  // Move focus into topmost sheet on open
  useEffect(() => {
    if (!open || !entered || !isTopmost) return;
    const panel = panelRef.current;
    if (!panel) return;
    const activeInside = panel.contains(document.activeElement);
    if (!activeInside) {
      const focusables = getFocusableElements(panel);
      if (focusables.length > 0) {
        focusables[0].focus({ preventScroll: true });
      } else {
        panel.focus({ preventScroll: true });
      }
    }
  }, [open, entered, isTopmost]);

  // Escape & Focus Trap for topmost sheet only
  useEffect(() => {
    if (!open || !isTopmost) return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onClose) onClose();
        return;
      }

      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = getFocusableElements(panel);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !panel.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last || !panel.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, isTopmost, onClose]);

  const handlePointerDown = useCallback(
    (e) => {
      if (!isTopmost) return;
      if (e.target.closest('button, a, input, select, textarea')) return;
      dragStartYRef.current = e.clientY;
      dragStartTimeRef.current = Date.now();
      setDragging(true);
      if (e.currentTarget.setPointerCapture) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    },
    [isTopmost]
  );

  const handlePointerMove = useCallback((e) => {
    if (dragStartYRef.current == null) return;
    const delta = e.clientY - dragStartYRef.current;
    setDragOffsetY(delta > 0 ? delta : 0);
  }, []);

  const handlePointerUp = useCallback(
    (e) => {
      if (dragStartYRef.current == null) return;
      const delta = e.clientY - dragStartYRef.current;
      const elapsed = Math.max(1, Date.now() - dragStartTimeRef.current);
      const velocity = delta / elapsed;

      dragStartYRef.current = null;
      setDragging(false);

      if (delta >= 85 || (delta >= 36 && velocity > 0.45)) {
        setDragOffsetY(0);
        if (onClose) onClose();
      } else {
        setDragOffsetY(0);
      }
    },
    [onClose]
  );

  if (!rendered || typeof document === 'undefined') return null;

  let transformValue = 'translateY(100%)';
  if (entered) {
    if (isUnderlay) {
      transformValue = 'translateY(-10px) scale(0.96)';
    } else if (dragOffsetY > 0) {
      transformValue = `translateY(${dragOffsetY}px)`;
    } else {
      transformValue = 'translateY(0)';
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ zIndex }}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={() => {
          if (isTopmost && onClose) onClose();
        }}
        className={`sheet-backdrop-motion fixed inset-0 bg-slate-950/55 dark:bg-black/70 backdrop-blur-[2px] transition-opacity duration-300 ${
          entered ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Sheet Container */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={isUnderlay ? 'true' : undefined}
        tabIndex={-1}
        style={{
          transform: transformValue,
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)'
        }}
        className={`sheet-motion relative w-full ${maxWidthClass} max-h-[92dvh] sm:max-h-[88dvh] flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-t-[26px] sm:rounded-[24px] border border-slate-200/80 dark:border-slate-800 shadow-2xl outline-none overflow-hidden ${
          dragging ? '' : 'transition-[transform,opacity,filter] duration-[340ms]'
        } ${isUnderlay ? 'opacity-60 brightness-90 pointer-events-none select-none' : 'opacity-100'}`}
      >
        {/* Drag Handle & Sticky Header */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="shrink-0 touch-none select-none border-b border-slate-100 dark:border-slate-800/90 bg-white dark:bg-slate-900 px-5 pt-2.5 pb-3.5"
        >
          <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mx-auto mb-3" />
          <div className="flex items-start justify-between gap-3">
            {headerLeading && <div className="shrink-0 mt-0.5">{headerLeading}</div>}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-lg font-bold text-slate-900 dark:text-slate-100 font-display truncate">
                {title}
              </h2>
              {subtitle && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{subtitle}</p>
              )}
              {headerExtra}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sheet"
              className="min-h-[44px] min-w-[44px] -mr-2 -mt-1 inline-flex items-center justify-center rounded-2xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>

        {/* Sticky Action Footer */}
        {footer && (
          <div className="shrink-0 border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-5 py-3.5 pb-safe">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
