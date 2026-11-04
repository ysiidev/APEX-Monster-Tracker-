/* Animate value changes without replacing, rounding, or counting through live
   financial data. The underlying text remains exact and immediately accessible. */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.querySelector('.wrap');
    if (!root || !window.MutationObserver || !window.matchMedia) return;
    var preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    var pending = new Set(), frame = null, active = new Set();
    function flush() {
      frame = null;
      if (!preference.matches && document.documentElement.classList.contains('staff-authenticated')) {
        pending.forEach(function (el) {
          if (!el.isConnected || !el.getClientRects().length || !el.animate) return;
          el.getAnimations().forEach(function (a) { a.cancel(); });
          var animation = el.animate([{opacity: .55, transform: 'translateY(3px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 350, easing: 'ease-out'});
          active.add(animation); animation.onfinish = animation.oncancel = function () { active.delete(animation); };
        });
      }
      pending.clear();
    }
    new MutationObserver(function (records) {
      if (preference.matches) return;
      records.forEach(function (record) {
        var node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        var value = node && node.closest('.num, .hnum, .qty, .v.tnum');
        if (value) pending.add(value);
      });
      if (pending.size && frame === null) frame = requestAnimationFrame(flush);
    }).observe(root, {childList: true, subtree: true, characterData: true});
    function cancelMotion() {
      if (!preference.matches) return;
      active.forEach(function (a) { a.cancel(); }); active.clear(); pending.clear();
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    }
    if (preference.addEventListener) preference.addEventListener('change', cancelMotion);
  });
})();
