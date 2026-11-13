import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, Modal, Text } from '@adminjs/design-system';

export function imageLabel(item, index, total) {
  const dimensions = item?.width && item?.height ? `, ${item.width} by ${item.height} pixels` : '';
  return `Open photo ${index + 1} of ${total}${dimensions}`;
}

export function MediaThumb({ item, index, total, description, onOpen }) {
  const [failed, setFailed] = useState(false);
  const unavailable = !item.url || failed;

  return (
    <button
      type="button"
      className="pupzy-media-thumb"
      data-testid="pupzy-media-thumb"
      data-unavailable={unavailable ? 'true' : 'false'}
      aria-label={unavailable ? `Photo ${index + 1} of ${total} is unavailable` : imageLabel(item, index, total)}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {unavailable ? (
        <span className="pupzy-media-fallback" role="img" aria-label="Image unavailable">
          <Icon icon="Image" />
          <span>Image unavailable</span>
        </span>
      ) : (
        <img src={item.url} alt={description} loading="lazy" onError={() => setFailed(true)} />
      )}
    </button>
  );
}

export function ImageDialog({ items, index, onClose, onNavigate }) {
  const containerRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const current = items[index];

  useEffect(() => {
    setFailed(false);
  }, [index]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowRight' && items.length > 1) {
        event.preventDefault();
        onNavigate(1);
        return;
      }
      if (event.key === 'ArrowLeft' && items.length > 1) {
        event.preventDefault();
        onNavigate(-1);
        return;
      }
      if (event.key === 'Tab') {
        const root = containerRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((element) => !element.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [items.length, onClose, onNavigate]);

  const unavailable = !current?.url || failed;

  return (
    <Modal onOverlayClick={onClose} width={['94vw', 'min(94vw, 1080px)']}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Full image preview, image ${index + 1} of ${items.length}`}
        className="pupzy-media-dialog"
        data-testid="pupzy-image-dialog"
        ref={containerRef}
      >
        <div className="pupzy-media-dialog-header">
          <Text fontWeight="bold" aria-live="polite">
            {index + 1} of {items.length}
          </Text>
          <Button
            ref={closeButtonRef}
            size="icon"
            variant="light"
            aria-label="Close image preview"
            data-testid="pupzy-image-dialog-close"
            onClick={onClose}
          >
            <Icon icon="X" />
          </Button>
        </div>

        {unavailable ? (
          <div className="pupzy-media-dialog-fallback" role="img" aria-label="Image unavailable">
            <Icon icon="Image" />
            <Text>This image is unavailable.</Text>
          </div>
        ) : (
          <img
            className="pupzy-media-dialog-content"
            data-testid="pupzy-image-dialog-content"
            src={current.url}
            alt={`Full preview ${index + 1} of ${items.length}`}
            onError={() => setFailed(true)}
          />
        )}

        {items.length > 1 ? (
          <div className="pupzy-media-dialog-nav">
            <Button
              variant="light"
              aria-label="Previous image"
              disabled={items.length < 2}
              onClick={() => onNavigate(-1)}
            >
              Previous
            </Button>
            <Button variant="light" aria-label="Next image" disabled={items.length < 2} onClick={() => onNavigate(1)}>
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Opens a list of images in the accessible dialog. `openMedia(items, index,
 * trigger)` shows it; closing restores focus to `trigger`. Render `dialog`
 * anywhere in the component.
 */
export function useMediaLightbox() {
  const [state, setState] = useState(null);
  const triggerRef = useRef(null);

  const openMedia = useCallback((items, index, trigger) => {
    triggerRef.current = trigger ?? null;
    setState({ items, index });
  }, []);

  const close = useCallback(() => {
    setState(null);
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger) trigger.focus();
  }, []);

  const navigate = useCallback((delta) => {
    setState((current) => {
      if (!current) return current;
      const nextIndex = (current.index + delta + current.items.length) % current.items.length;
      return { ...current, index: nextIndex };
    });
  }, []);

  const dialog = state ? (
    <ImageDialog items={state.items} index={state.index} onClose={close} onNavigate={navigate} />
  ) : null;
  return { openMedia, dialog };
}
