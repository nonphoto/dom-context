import { animate, mix } from "https://cdn.skypack.dev/popmotion";
import {
  layoutNode,
  updateProjectionStyle,
} from "https://cdn.skypack.dev/projection@2.0.0-alpha.3";

export function pixelsToPercent(pixels, min, max) {
  return (pixels / (max - min)) * 100;
}

export function mixRect(prev, next, p) {
  return {
    top: mix(prev.top, next.top, p),
    left: mix(prev.left, next.left, p),
    right: mix(prev.right, next.right, p),
    bottom: mix(prev.bottom, next.bottom, p),
  };
}

export function animateRect(rect, options = {}) {
  const result = Stream.data(Stream.sample(rect));
  Stream((prev) => {
    if (prev && rect()) {
      animate({
        ...options,
        from: 0,
        to: 1,
        onUpdate: (p) => void result(mixRect(prev, rect(), p)),
      });
    } else {
      result(rect());
    }
    return rect();
  }, Stream.sample(rect));
  return result;
}

export function getLayoutRect(element, trigger) {
  const rect = Stream.data();
  const childTrigger = Stream.data();
  Stream.on([element, trigger], () => {
    if (element()) {
      element().style.transform = "";
      childTrigger(null);
      rect(element().getBoundingClientRect());
    }
  });
  return [rect, childTrigger];
}

export function projectElement(
  element,
  targetRect,
  layoutRect,
  parent,
  borderRadius = 16
) {
  return Stream(() => {
    if (element()) {
      const projection = layoutNode(
        {
          onProjectionUpdate: () =>
            updateProjectionStyle(element(), projection),
        },
        typeof parent === "function" ? parent() : undefined
      );
      Stream.cleanup(() => {
        projection.destroy();
      });
      Stream(() => {
        if (layoutRect()) {
          projection.setLayout(layoutRect());
        }
      });
      Stream.on([targetRect, layoutRect], () => {
        if (targetRect()) {
          projection.setTarget(targetRect());
          element().style.borderRadius = `${pixelsToPercent(
            borderRadius,
            targetRect().left,
            targetRect().right
          )}% / ${pixelsToPercent(
            borderRadius,
            targetRect().top,
            targetRect().bottom
          )}%`;
        }
      });
      return projection;
    }
  });
}

export function animatedElement(context) {
  const element = Stream.data();
  const [layoutRect, layoutTrigger] = getLayoutRect(
    element,
    context.layoutTrigger
  );
  const targetRect = animateRect(layoutRect);
  const projection = projectElement(
    element,
    targetRect,
    layoutRect,
    context.projection
  );
  return { element, projection, layoutTrigger };
}
