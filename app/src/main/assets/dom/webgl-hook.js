(function() {
  try {
    var o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(t, a) {
      if (t === "webgl" || t === "webgl2" || t === "experimental-webgl") {
        a = Object.assign({}, a || {}, { preserveDrawingBuffer: true });
      }
      return o.call(this, t, a);
    };
  } catch (e) {}
})();
