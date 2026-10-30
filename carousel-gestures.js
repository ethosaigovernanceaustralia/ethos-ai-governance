'use strict';

(function(root) {
  function attachCarouselGestures(surface, changeCard) {
    let pointer = null;
    let suppressClickUntil = -Infinity;
    let lastWheelTime = -Infinity;
    let wheelDistance = 0;
    let wheelChanged = false;

    surface.addEventListener('pointerdown', event => {
      if (event.isPrimary === false) { pointer = null; return; }
      if (event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, vertical: false };
      // Sample cards can be dragged with a mouse as well as swiped by touch.
      if (event.pointerType === 'mouse') event.preventDefault();
    });

    surface.addEventListener('pointermove', event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.2) pointer.vertical = true;
      if (!pointer.vertical && Math.abs(dx) > 10 && surface.setPointerCapture) {
        surface.setPointerCapture(event.pointerId);
      }
    });

    surface.addEventListener('pointerup', event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const start = pointer;
      pointer = null;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.vertical || Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
      suppressClickUntil = event.timeStamp + 500;
      changeCard(dx < 0 ? 1 : -1);
    });

    const cancelPointer = () => { pointer = null; };
    surface.addEventListener('pointercancel', cancelPointer);
    surface.addEventListener('lostpointercapture', cancelPointer);

    // A completed swipe must not also activate the card under the released finger.
    surface.addEventListener('click', event => {
      if (event.detail !== 0 && event.timeStamp <= suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    surface.addEventListener('wheel', event => {
      // Leave normal page scrolling and trackpad pinch-to-zoom to the browser.
      if (event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      if (event.cancelable) event.preventDefault();
      if (event.timeStamp - lastWheelTime > 180) {
        wheelDistance = 0;
        wheelChanged = false;
      }
      lastWheelTime = event.timeStamp;
      if (wheelChanged) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientWidth : 1;
      wheelDistance += event.deltaX * unit;
      if (Math.abs(wheelDistance) >= 48) {
        wheelChanged = true;
        changeCard(wheelDistance > 0 ? 1 : -1);
      }
    }, { passive: false });

    surface.addEventListener('keydown', event => {
      if (event.target !== surface || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      changeCard(event.key === 'ArrowRight' ? 1 : -1);
    });
  }

  if (typeof module === 'object' && module.exports) module.exports = attachCarouselGestures;
  else root.attachCarouselGestures = attachCarouselGestures;
})(typeof window === 'undefined' ? globalThis : window);
